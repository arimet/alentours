// Mobile coverage tiles ("Mon réseau mobile", Arcep), pre-computed by scripts/mobile.mjs.
//
// One file per department, public/data/mobile/<dep>.bin:
//   bytes 0-3     "MOB1"
//   bytes 4-7     header length n (uint32, little endian)
//   bytes 8..8+n  header, UTF-8 JSON (see Header)
//   from 4096     cells, row-major from the north-west corner, BYTES_PER_CELL(layers) bytes each.
//                 Layer i sits in byte i>>2 at bit (i&3)*2: 0 none, 1 limited, 2 good, 3 very good.
// The grid is in the projection Arcep publishes each territory in (Lambert-93 in metropolitan
// France, the local UTM zone overseas), so polygons are rasterized without reprojection and each
// cell is a true 200 m square. The browser projects the BAN point with the formulas below.
// Data starts at a fixed offset so a reader needs two small HTTP Range requests (header, then its
// one cell) instead of the whole file: a few kilobytes per address, whatever the department size.

import type { BlockView, Fact } from './block.ts';

export const MAGIC = 'MOB1';
export const DATA_OFFSET = 4096;

export type Layer = {
  operator: string;
  techno: string;
  /** "2026-03-31" */
  date: string;
  /** false when Arcep publishes no levels (5G): any non-zero value then only means "covered". */
  graded?: false;
};
export type Header = {
  epsg: number;
  /** West and north edges of the grid, in metres. */
  x0: number;
  y0: number;
  cell: number;
  width: number;
  height: number;
  layers: Layer[];
};
/** 0 none, 1 limited ("limitée"), 2 good ("bonne"), 3 very good ("très bonne"). */
export type Coverage = 0 | 1 | 2 | 3;

export const bytesPerCell = (layers: number) => Math.ceil(layers / 4);

// GRS80 ellipsoid (RGF93, RGAF09, RGFG95, RGR92, RGM04 all use it; WGS84 differs by < 1 mm).
const A = 6378137, F = 1 / 298.257222101, E2 = 2 * F - F * F, E = Math.sqrt(E2);
const rad = Math.PI / 180;

/** RGF93 / Lambert-93 (EPSG:2154). */
export const lambert93 = (lat: number, lon: number): [number, number] => {
  const m = (p: number) => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  const t = (p: number) => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
  const p1 = 44 * rad, p2 = 49 * rad, p0 = 46.5 * rad;
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const aF = (A * m(p1)) / (n * t(p1) ** n);
  const r = aF * t(lat * rad) ** n, r0 = aF * t(p0) ** n, g = n * (lon - 3) * rad;
  return [700000 + r * Math.sin(g), 6600000 + r0 - r * Math.cos(g)];
};

/** Universal Transverse Mercator on GRS80 (Snyder's series, well under a metre inside a zone). */
export const utm = (lat: number, lon: number, zone: number, south: boolean): [number, number] => {
  const p = lat * rad, ep2 = E2 / (1 - E2), k0 = 0.9996;
  const N = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = ep2 * Math.cos(p) ** 2;
  const a = (lon - (zone * 6 - 183)) * rad * Math.cos(p);
  const e4 = E2 * E2, e6 = e4 * E2;
  const M = A * ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * p - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * p)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * p) - ((35 * e6) / 3072) * Math.sin(6 * p));
  const x = k0 * N * (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * a ** 5) / 120);
  const y = k0 * (M + N * Math.tan(p) * (a * a / 2 + ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * a ** 6) / 720));
  return [500000 + x, (south ? 10000000 : 0) + y];
};

/** Projections Arcep publishes in (documentation_couverture.md). */
const UTM: Record<number, [number, boolean]> = { 5490: [20, false], 2972: [22, false], 2975: [40, true], 4471: [38, true] };

export const project = (epsg: number, lat: number, lon: number): [number, number] => {
  if (epsg === 2154) return lambert93(lat, lon);
  const z = UTM[epsg];
  if (!z) throw new Error(`Projection ${epsg} inconnue`);
  return utm(lat, lon, z[0], z[1]);
};

export const parseHeader = (bytes: Uint8Array): Header => {
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error('Fichier de couverture illisible');
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + n)));
};

/** Byte range of the cell holding the point, or undefined outside the grid. */
export const cellRange = (h: Header, lat: number, lon: number) => {
  const [x, y] = project(h.epsg, lat, lon);
  const col = Math.floor((x - h.x0) / h.cell), row = Math.floor((h.y0 - y) / h.cell);
  if (col < 0 || row < 0 || col >= h.width || row >= h.height) return undefined;
  const size = bytesPerCell(h.layers.length);
  const start = DATA_OFFSET + (row * h.width + col) * size;
  return { start, end: start + size }; // end exclusive
};

/** Coverage of each header layer, from the bytes of one cell. */
export const decodeCell = (h: Header, cell: Uint8Array): Coverage[] =>
  h.layers.map((_, i) => ((cell[i >> 2] >> ((i & 3) * 2)) & 3) as Coverage);

/** Whole-file convenience: coverage per layer at a point (undefined outside the grid). */
export const readPoint = (file: Uint8Array, lat: number, lon: number) => {
  const h = parseHeader(file);
  const r = cellRange(h, lat, lon);
  return r && decodeCell(h, file.subarray(r.start, r.end));
};

/** Builds a tile. `grids[i]` holds layer i's levels (0..3), one byte per cell, row-major. */
export const encodeTile = (h: Header, grids: Uint8Array[]) => {
  const json = new TextEncoder().encode(JSON.stringify(h));
  if (8 + json.length > DATA_OFFSET) throw new Error('Header too long');
  const size = bytesPerCell(h.layers.length), cells = h.width * h.height;
  const out = new Uint8Array(DATA_OFFSET + cells * size);
  out.set(new TextEncoder().encode(MAGIC));
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  grids.forEach((g, i) => {
    const byte = i >> 2, shift = (i & 3) * 2;
    for (let c = 0; c < cells; c++) out[DATA_OFFSET + c * size + byte] |= (g[c] & 3) << shift;
  });
  return out;
};

// ---- Sheet view ----

const WORDS = ['pas de couverture', 'couverture limitée', 'bonne couverture', 'très bonne couverture'];

// Arcep's reading keys for 4G data, shortened.
const MEANING = [
  'Pas d’internet mobile prévu à l’adresse.',
  'Internet mobile possible dehors, probablement pas à l’intérieur.',
  'Internet mobile dehors, et parfois à l’intérieur.',
  'Internet mobile dehors et, le plus souvent, à l’intérieur.',
];

/** "2026-03-31" → "31/03/2026". */
const frDate = (iso: string) => iso.split('-').reverse().join('/');

export const SOURCE_URL = 'https://www.data.gouv.fr/datasets/mon-reseau-mobile';

export const mobileView = (h: Header, levels: Coverage[]): BlockView => {
  const operators = [...new Set(h.layers.map((l) => l.operator))];
  const facts: Fact[] = operators.map((op) => {
    const mine = h.layers.map((l, i) => ({ ...l, level: levels[i] })).filter((l) => l.operator === op);
    const g4 = mine.find((l) => l.techno === '4G');
    return {
      label: op,
      value: mine.map((l) => `${l.techno} : ${l.graded === false && l.level ? 'disponible' : WORDS[l.level]}`).join(', '),
      // The icon follows the 4G level, the one that decides whether internet works.
      ...(g4 ? { level: g4.level >= 2 ? 'ok' : g4.level === 1 ? 'warn' : 'alert', detail: MEANING[g4.level] } : {}),
    } as Fact;
  });
  const dates = [...new Set(h.layers.map((l) => l.date))].sort().reverse();
  const updated = dates.length === 1 ? frDate(dates[0])
    : dates.map((d) => `${frDate(d)} (${[...new Set(h.layers.filter((l) => l.date === d).map((l) => l.techno))].join(', ')})`).join(' et du ');
  return {
    facts,
    explanation: 'Niveau de couverture en internet mobile prévu par chaque opérateur au centre du carreau de 200 m où se trouve l’adresse.',
    precision: 'carreau de 200 m autour de l’adresse',
    source: { name: 'Arcep, « Mon réseau mobile »', url: SOURCE_URL, updated },
    notes: ['Ces cartes sont des simulations fournies par les opérateurs, pas des mesures. Précision d’environ 100 m ; la couverture à l’intérieur des bâtiments peut être moins bonne.'],
  };
};
