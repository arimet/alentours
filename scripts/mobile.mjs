// Builds public/data/mobile/<dep>.bin from Arcep's theoretical coverage maps ("Mon réseau mobile").
//
//   node scripts/mobile.mjs            every department (metropolitan France + overseas departments)
//   node scripts/mobile.mjs 971 972    only these (a territory is processed as a whole)
//   node scripts/mobile.mjs --version  prints the latest Arcep quarter (the CI cache key)
//
// Needs 7-Zip (7z or 7zz) and GDAL (gdal_rasterize, ogrinfo). For each territory and each
// operator × techno (4G, 5G; 2G/3G are skipped in V1), takes the most recent quarter publishing it,
// rasterizes its polygons on a 200 m grid in Arcep's own projection (a cell gets the level of the
// polygon holding its centre, the best one where levels overlap), then cuts one tile per department
// around its communes' bounding box. Files are processed one at a time and deleted after use:
// the metropolitan GeoPackages weigh several gigabytes each once decompressed.

import { execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { encodeTile, project } from '../src/lib/mobile.ts';

const BASE = 'https://data.arcep.fr/mobile/couvertures_theoriques/';
const OUT = 'public/data/mobile';
const WORK = process.env.MOBILE_WORK ?? join(tmpdir(), 'mobile-arcep');
const CELL = 200;
const TECHNOS = ['4G', '5G'];

// Arcep file codes → commercial names; the order is the display order.
const OPERATORS = {
  OF: 'Orange', SFR0: 'SFR', BOUY: 'Bouygues Telecom', FREE: 'Free Mobile',
  ORCA: 'Orange Caraïbe', OMT: 'SFR Caraïbe', FRCA: 'Free Caraïbe', DIGIC: 'Digicel',
  DAUPH: 'Dauphin Telecom', UTS: 'UTS Caraïbe', SRR: 'SFR Réunion', TELC: 'Telco OI', MAOR: 'Maoré Mobile', BJT: 'Maoré Mobile',
};

// Territory → Arcep folder and projection (documentation_couverture.md).
const TERRITORIES = {
  Metropole: { dir: 'Metropole/00_Metropole', epsg: 2154 },
  971: { dir: 'Outremer/971_Guadeloupe', epsg: 5490 },
  972: { dir: 'Outremer/972_Martinique', epsg: 5490 },
  973: { dir: 'Outremer/973_Guyane', epsg: 2972 },
  974: { dir: 'Outremer/974_LaReunion', epsg: 2975 },
  976: { dir: 'Outremer/976_Mayotte', epsg: 4471 },
  977: { dir: 'Outremer/977_SaintBarthelemy', epsg: 5490 },
  978: { dir: 'Outremer/978_SaintMartin', epsg: 5490 },
};

const hrefs = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return [...(await res.text()).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
};

/** Quarter folders, most recent first ("2026_T1", "2025_T4"…). */
const quarters = async () => (await hrefs(BASE)).map((h) => h.match(/^(\d{4}_T\d)\//)?.[1]).filter(Boolean).sort().reverse();

/** Most recent file per operator × techno, looking at the last two quarters (5G and 2G/3G are half-yearly). */
const layersOf = async (territory, qs) => {
  const found = new Map();
  for (const q of qs.slice(0, 2)) {
    const files = await hrefs(`${BASE}${q}/${TERRITORIES[territory].dir}/`).catch(() => []);
    for (const f of files) {
      const m = f.match(/^(\d{4}_T\d)_couv_\w+?_([A-Z0-9]+)_(\dG)_data\.gpkg\.7z$/);
      if (m && TECHNOS.includes(m[3]) && !found.has(`${m[2]} ${m[3]}`))
        found.set(`${m[2]} ${m[3]}`, { url: `${BASE}${q}/${TERRITORIES[territory].dir}/${f}`, name: f.replace('.7z', ''), code: m[2], techno: m[3] });
    }
  }
  const rank = Object.keys(OPERATORS);
  return [...found.values()].sort((a, b) => rank.indexOf(a.code) - rank.indexOf(b.code) || a.techno.localeCompare(b.techno));
};

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const sevenZip = ['7z', '7zz'].find((c) => { try { run(c, ['i']); return true; } catch { return false; } });

/** Department → [minX, minY, maxX, maxY] in the territory's projection, from its communes (+2 km). */
const departmentBoxes = async () => {
  const communes = await (await fetch('https://geo.api.gouv.fr/communes?fields=codeDepartement,bbox')).json();
  const boxes = {};
  for (const c of communes) {
    const dep = c.codeDepartement;
    const territory = dep.length === 2 ? 'Metropole' : dep;
    if (!TERRITORIES[territory] || !c.bbox) continue;
    const ring = c.bbox.coordinates[0], lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
    const b = (boxes[dep] ??= { territory, box: [Infinity, Infinity, -Infinity, -Infinity] }).box;
    // Sample the box edges: straight lon/lat edges bend once projected.
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const lon = Math.min(...lons) + ((Math.max(...lons) - Math.min(...lons)) * i) / 4;
      const lat = Math.min(...lats) + ((Math.max(...lats) - Math.min(...lats)) * j) / 4;
      const [x, y] = project(TERRITORIES[territory].epsg, lat, lon);
      b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
    }
  }
  for (const d of Object.values(boxes)) // pad and snap outwards to the 200 m lattice
    d.box = d.box.map((v, i) => (i < 2 ? Math.floor((v - 2000) / CELL) * CELL : Math.ceil((v + 2000) / CELL) * CELL));
  return boxes;
};

const download = async (url, file) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
};

/** One layer rasterized on the territory grid: one byte per cell, 0..3. */
const rasterize = async (layer, [minX, minY, maxX, maxY]) => {
  const archive = join(WORK, `${layer.name}.7z`), gpkg = join(WORK, layer.name), raw = join(WORK, `${layer.name}.raw`);
  await download(layer.url, archive);
  run(sevenZip, ['x', '-y', `-o${WORK}`, archive]);
  rmSync(archive);
  const table = layer.name.replace('.gpkg', '');
  const date = run('ogrinfo', ['-q', '-dialect', 'SQLite', '-sql', `SELECT max(date) AS d, max(niveau) AS n FROM "${table}"`, gpkg]);
  // Where overlapping polygons have different levels, the best one is burned last and wins.
  // 5G is published without levels: a covered cell gets 1 and the header marks the layer ungraded.
  run('gdal_rasterize', ['-q', '-of', 'ENVI', '-ot', 'Byte', '-init', '0', '-te', minX, minY, maxX, maxY, '-tr', CELL, CELL,
    '-dialect', 'SQLite', '-sql', `SELECT geom, CASE niveau WHEN 'TBC' THEN 3 WHEN 'BC' THEN 2 ELSE 1 END AS lvl FROM "${table}" ORDER BY lvl`,
    '-a', 'lvl', gpkg, raw].map(String));
  rmSync(gpkg);
  const grid = readFileSync(raw);
  for (const ext of ['', '.aux.xml']) rmSync(raw + ext, { force: true });
  rmSync(raw.replace(/\.raw$/, '.hdr'), { force: true });
  return {
    grid,
    operator: OPERATORS[layer.code] ?? layer.code,
    techno: layer.techno,
    date: date.match(/d \(String\) = (\S+)/)?.[1] ?? '',
    graded: /n \(String\) = \S/.test(date),
  };
};

const main = async () => {
  const qs = await quarters();
  if (process.argv[2] === '--version') return console.log(qs[0]);
  if (!sevenZip) throw new Error('7-Zip not found (7z or 7zz)');
  const only = process.argv.slice(2);
  const boxes = await departmentBoxes();
  mkdirSync(WORK, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  for (const territory of Object.keys(TERRITORIES)) {
    const deps = Object.keys(boxes).filter((d) => boxes[d].territory === territory && (!only.length || only.includes(d)));
    if (!deps.length) continue;
    const t0 = Date.now();
    const box = deps.reduce((b, d) => boxes[d].box.map((v, i) => (i < 2 ? Math.min(v, b[i]) : Math.max(v, b[i]))), [Infinity, Infinity, -Infinity, -Infinity]);
    const width = (box[2] - box[0]) / CELL;
    const layers = [];
    for (const l of await layersOf(territory, qs)) {
      layers.push(await rasterize(l, box));
      console.log(`${territory} ${l.code} ${l.techno}: ${Math.round((Date.now() - t0) / 1000)} s`);
    }
    if (!layers.length) { console.warn(`${territory}: no map found`); continue; }
    for (const dep of deps) {
      const [x0, y0, x1, y1] = boxes[dep].box;
      const w = (x1 - x0) / CELL, h = (y1 - y0) / CELL;
      const col = (x0 - box[0]) / CELL, row = (box[3] - y1) / CELL;
      const grids = layers.map(({ grid }) => {
        const g = new Uint8Array(w * h);
        for (let r = 0; r < h; r++) g.set(grid.subarray((row + r) * width + col, (row + r) * width + col + w), r * w);
        return g;
      });
      const header = {
        epsg: TERRITORIES[territory].epsg, x0, y0: y1, cell: CELL, width: w, height: h,
        layers: layers.map(({ operator, techno, date, graded }) => ({ operator, techno, date, ...(graded ? {} : { graded: false }) })),
      };
      writeFileSync(join(OUT, `${dep}.bin`), encodeTile(header, grids));
    }
    console.log(`${territory}: ${deps.length} department(s), ${Math.round((Date.now() - t0) / 1000)} s`);
  }
};

await main();
