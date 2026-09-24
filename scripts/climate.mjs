// Builds public/data/climate/<dep>.json: future climate at the commune, from Météo-France open data
// (Licence Ouverte Etalab 2.0, see the DRIAS conditions of use). Run: node scripts/climate.mjs [outDir].
// Needs Node 24, no npm dependency: tar and CSV are read by hand below. About 650 MB to download.
//
// Sources, both in Météo-France's public bucket object.files.data.gouv.fr/meteofrance-drias:
// - Climadiag Commune (CLIMADIAG_COMMUNE/donnees_climadiag_commune_v<n>_<date>.tar): one CSV per
//   commune, from one 8 km SAFRAN cell chosen by Météo-France for the commune. Reference 1976-2005,
//   then low, median and high (90 % interval of the models) at the TRACC horizons 2030, 2050 and 2100,
//   that is +2, +2.7 and +4 °C for the Hexagone and Corsica. Paris, Lyon and Marseille as whole communes.
// - TRACC-2023 on the Explore2 8 km grid, for days ≥ 30 °C (not in Climadiag): ENSmin, ENSq50 and
//   ENSmax of the models at each warming level, read at the cell nearest to the commune centre
//   (geo.api.gouv.fr). Values are pandas Timedelta strings ("11 days 22:47:59.98").
// Overseas communes are left out: Climadiag has other indicators and warming levels there, and
// TRACC-2023 covers the Hexagone and Corsica only.

import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fetchRetry } from './retry.mjs';
import { byDepartment } from './internet.mjs';

const BUCKET = 'https://object.files.data.gouv.fr/meteofrance-drias';
const TRACC = `${BUCKET}/TRACC-2023/CSV_wk_032025/Indicateurs-Absolue_Centiles-Explore2-Climat_Moyenne-20ans`;
const LEVELS = ['historical', 'RWL20', 'RWL27', 'RWL40'];
const STATS = ['ENSmin', 'ENSq50', 'ENSmax'];
const HORIZONS = ['2030', '2050', '2100'];
/** Climadiag code → key in the output. dry: summer days with dry soil (R5, SWI < 0.4). */
const INDICATORS = { S1: 'd35', S2: 'n20', S3: 'hw', R4: 'fire', R5: 'dry' };

/** "11 days 22:47:59.98" → 11.95; "nan" → null. */
export const parseDays = (v) => {
  const m = /^(\d+) days (\d+):(\d+):([\d.]+)$/.exec(v.trim());
  return m ? +m[1] + (+m[2] + +m[3] / 60 + +m[4] / 3600) / 24 : null;
};

const splitCsv = (line) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);

/**
 * One Climadiag commune CSV → { d35, n20, hw, fire, dry }, each
 * [ref, low, median, high at 2030, the same at 2050, the same at 2100] (10 integers).
 */
export const parseClimadiag = (text) => {
  const [head, ...lines] = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const col = Object.fromEntries(splitCsv(head).map((c, i) => [c, i]));
  const out = {};
  for (const l of lines) {
    const r = splitCsv(l);
    const key = INDICATORS[r[col.indicateur_id]];
    const h = HORIZONS.indexOf(r[col.horizon]);
    if (!key || h < 0 || (key === 'dry' && r[col.label] !== 'été')) continue;
    const v = (out[key] ??= Array(10).fill(null));
    v[0] = Number(r[col.ref]);
    v.splice(1 + 3 * h, 3, Number(r[col.low]), Number(r[col.median]), Number(r[col.high]));
  }
  return out;
};

/** One TRACC CSV → Map(point id → { lat, lon, v: days | null }). */
const parseTracc = (text) => {
  const out = new Map();
  for (const l of text.split(/\r?\n/)) {
    if (!/^\d/.test(l)) continue; // comments and header
    const [id, lat, lon, , value] = l.split(';');
    out.set(id, { lat: +lat, lon: +lon, v: parseDays(value) });
  }
  return out;
};

/**
 * TX30D files by level and statistic → grid cells { id, lat, lon, d30 } with d30 laid out like
 * Climadiag: 1976-2005 median, then ENSmin, ENSq50, ENSmax at +2, +2.7 and +4 °C. Cells outside
 * France (nan) are dropped.
 */
export const traccGrid = (files) => {
  const parsed = Object.fromEntries(LEVELS.map((l) => [l, Object.fromEntries(STATS.map((s) => [s, parseTracc(files[l][s])]))]));
  const cells = [];
  for (const [id, { lat, lon }] of parsed.historical.ENSq50) {
    const d30 = [parsed.historical.ENSq50.get(id).v, ...LEVELS.slice(1).flatMap((l) => STATS.map((s) => parsed[l][s].get(id)?.v ?? null))];
    if (d30.every((x) => x !== null)) cells.push({ id, lat, lon, d30: d30.map(Math.round) });
  }
  return cells;
};

/** Nearest cell (equirectangular distance, fine at 8 km). */
export const nearest = (cells, lat, lon) => {
  const k = Math.cos((lat * Math.PI) / 180);
  let best, min = Infinity;
  for (const c of cells) {
    const d = (c.lat - lat) ** 2 + ((c.lon - lon) * k) ** 2;
    if (d < min) { min = d; best = c; }
  }
  return best;
};

/** climadiag: INSEE code → CSV text; centres: INSEE code → [lon, lat]. */
export const buildEntries = ({ climadiag, grid, centres }) => {
  const out = {};
  for (const [code, text] of Object.entries(climadiag)) {
    if (/^9[78]/.test(code)) continue; // overseas: see the header
    const e = parseClimadiag(text);
    const c = centres[code];
    if (c) e.d30 = nearest(grid, c[1], c[0]).d30;
    out[code] = e;
  }
  return out;
};

/** Regular files of a (ustar) tar buffer. */
export function* readTar(buf) {
  for (let o = 0; o + 512 <= buf.length && buf[o]; ) {
    const str = (a, b) => buf.toString('utf8', o + a, o + b).replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = str(156, 157);
    const name = [str(345, 500), str(0, 100)].filter(Boolean).join('/');
    if (type === '0' || type === '') yield { name, data: buf.subarray(o + 512, o + 512 + size) };
    o += 512 + Math.ceil(size / 512) * 512;
  }
}

/** Latest Climadiag Commune CSV tar in an S3 listing (the file name changes with each version). */
export const latestClimadiag = (xml) => {
  const found = [...xml.matchAll(/<Key>(CLIMADIAG_COMMUNE\/donnees_climadiag_commune_(v\d+)_(\d{4})(\d\d)(\d\d)\.tar)<\/Key>/g)]
    .map(([, key, version, y, m, d]) => ({ key, version, date: `${y}-${m}-${d}` }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.version.localeCompare(a.version, 'en', { numeric: true }));
  return found[0];
};

const main = async () => {
  const outDir = process.argv[2] ?? 'public/data/climate';
  const cache = process.env.CACHE_DIR ?? join(tmpdir(), 'climate-data');
  mkdirSync(cache, { recursive: true });
  const ok = async (url) => { const r = await fetchRetry(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r; };
  const get = async (url, name) => {
    const file = join(cache, name);
    if (!existsSync(file)) { console.log(`GET ${url}`); writeFileSync(file, Buffer.from(await (await ok(url)).arrayBuffer())); }
    return readFileSync(file);
  };

  const latest = latestClimadiag(await (await ok(`${BUCKET}/?list-type=2&prefix=CLIMADIAG_COMMUNE/`)).text());
  if (!latest) throw new Error('No Climadiag Commune CSV tar in the bucket listing');
  const climadiag = {};
  for (const f of readTar(await get(`${BUCKET}/${latest.key}`, latest.key.split('/').pop()))) {
    const m = /indicateurs_par_commune\/([\dAB]{5})\.csv$/.exec(f.name);
    if (m) climadiag[m[1]] = f.data.toString('utf8');
  }

  const files = {};
  for (const l of LEVELS) {
    files[l] = {};
    for (const f of readTar(await get(`${TRACC}_${l}_csv.tar`, `tracc-${l}.tar`))) {
      const m = /^TX30D_yr_(?:RWL-\d\d|historical)_TIMEavg_GEOxy_.*_(ENS\w+)\.csv$/.exec(f.name.split('/').pop());
      if (m && STATS.includes(m[1])) files[l][m[1]] = f.data.toString('utf8');
    }
  }
  const centres = Object.fromEntries((await (await ok('https://geo.api.gouv.fr/communes?fields=code,centre&format=json')).json())
    .filter((c) => c.centre).map((c) => [c.code, c.centre.coordinates]));

  const entries = buildEntries({ climadiag, grid: traccGrid(files), centres });
  const _meta = { version: latest.version, date: latest.date };
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const deps = byDepartment(entries);
  for (const [dep, e] of Object.entries(deps)) writeFileSync(join(outDir, `${dep}.json`), JSON.stringify({ ...e, _meta }));
  const sizes = readdirSync(outDir).map((f) => readFileSync(join(outDir, f)).length);
  const missing = Object.values(entries).filter((e) => !e.d30).length;
  console.log(`${sizes.length} files, ${(sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} MB (largest ${(Math.max(...sizes) / 1e6).toFixed(2)} MB), ${Object.keys(entries).length} communes, ${missing} without days ≥ 30 °C`);
};

if (import.meta.main) await main();
