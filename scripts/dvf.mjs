// Yearly DVF aggregates per commune, pre-computed from the raw geo-dvf files (no CORS, so build time only).
//
//   node scripts/dvf.mjs            every department of the latest release
//   node scripts/dvf.mjs 05 75 972  only these
//
// Writes public/data/dvf/<dep>.json:
//   { "<insee>": { years: [...], appartement: { median: [...], n: [...] }, maison: {...} }, _meta: {...} }
// (appartement = flat, maison = house: French keys kept, as the published files and src/lib/housing.ts use them)
// Only aggregates, never individual sales (DGFiP terms forbid re-identification).
//
// Method: the one of data.gouv's "Statistiques DVF", read in their pipeline
// (github.com/datagouv/datagouvfr_data_pipelines, data_processing/dvf/explore/task_functions.py) and in the
// dataset description (www.data.gouv.fr/fr/datasets/statistiques-dvf/):
//   1. drop exact duplicate rows (on the columns the pipeline keeps);
//   2. keep natures "Vente", "Vente en l'état futur d'achèvement", "Adjudication";
//   3. keep houses ("maisons", 1), flats ("appartements", 2) and premises ("locaux", 4); outbuildings and land do not count;
//   4. keep single-property mutations: the id_mutation appears once after 2 and 3;
//   5. price/m² = valeur_fonciere / surface_reelle_bati; drop when it cannot be computed or is >= 100 000 €/m².
// No other outlier filter: the official statistics deliberately have none. We follow their monthly computation
// (the closest to a yearly one); their whole-period file skips the 100 000 € guard, which explains a one-sale gap
// in Paris 7e (4 610 apartments here, 4 611 there; without the guard we get 4 611 and 18 houses, like them).
// Their monthly and whole-period medians are shown whatever the sample size; ours hide a median below MIN_SALES
// (our choice, see below). The whole-period figures of Saint-Véran match the official ones (tests/dvf.test.mjs).

import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://files.data.gouv.fr/geo-dvf/latest/csv/';
const OUT = new URL('../public/data/dvf/', import.meta.url);
const NATURES = new Set(['Vente', "Vente en l'état futur d'achèvement", 'Adjudication']);
const TYPES = new Set(['1', '2', '4']);
const KINDS = { 1: 'maison', 2: 'appartement' };
// Columns the official pipeline keeps before dropping duplicates.
const KEEP = ['id_mutation', 'date_mutation', 'code_departement', 'code_commune', 'id_parcelle', 'nature_mutation', 'code_type_local', 'type_local', 'valeur_fonciere', 'surface_reelle_bati'];

/** Our choice, the official method has no minimum: a median of 1 to 4 sales is close to an individual price and too noisy. */
export const MIN_SALES = 5;

/** One CSV line; geo-dvf has no quotes in practice, the slow path is only a safety net. */
export const parseLine = (line) => {
  if (!line.includes('"')) return line.split(',');
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
};

// pandas reads an empty cell as NaN, and NaN / x, x / 0 are dropped.
const num = (s) => (s === '' || s === undefined ? NaN : Number(s));

/**
 * Prices per m² of one year file, by commune and kind: Map<insee, { maison: number[], appartement: number[] }>.
 * `lines` is an (async) iterable of CSV lines, header first.
 */
export const pricesOfYear = async (lines) => {
  let col, seen = new Set(), muts = new Map(), dates = [];
  for await (const line of lines) {
    if (!line) continue;
    const f = parseLine(line);
    if (!col) { col = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
    const key = KEEP.map((k) => f[col[k]]).join('\u0001');
    if (seen.has(key)) continue;
    seen.add(key);
    if (!NATURES.has(f[col.nature_mutation]) || !TYPES.has(f[col.code_type_local])) continue;
    const id = f[col.id_mutation], m = muts.get(id);
    if (m) { m.count++; continue; }
    muts.set(id, { count: 1, insee: f[col.code_commune], type: f[col.code_type_local], date: f[col.date_mutation], price: num(f[col.valeur_fonciere]) / num(f[col.surface_reelle_bati]) });
  }
  const out = new Map();
  for (const m of muts.values()) {
    if (m.count !== 1 || !KINDS[m.type] || !Number.isFinite(m.price) || m.price >= 100000) continue;
    if (!out.has(m.insee)) out.set(m.insee, { maison: [], appartement: [] });
    out.get(m.insee)[KINDS[m.type]].push(m.price);
    dates.push(m.date);
  }
  dates.sort();
  return { communes: out, from: dates[0], to: dates.at(-1) };
};

/** Median as pandas computes it (mean of the two middle values), rounded to the euro. */
export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), h = s.length >> 1;
  return Math.round(s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2);
};

/** Per-commune yearly series from [{ year, communes }], medians below MIN_SALES set to null. */
export const buildDepartment = (perYear) => {
  const years = perYear.map((y) => y.year);
  const insees = [...new Set(perYear.flatMap((y) => [...y.communes.keys()]))].sort();
  const series = (insee, kind) => {
    const lists = perYear.map((y) => y.communes.get(insee)?.[kind] ?? []);
    return { median: lists.map((l) => (l.length >= MIN_SALES ? median(l) : null)), n: lists.map((l) => l.length) };
  };
  return Object.fromEntries(insees.map((i) => [i, { years, appartement: series(i, 'appartement'), maison: series(i, 'maison') }]));
};

const listing = async (url) => [...(await (await fetch(url)).text()).matchAll(/href="[^"]*\/([^/"]+?)\/?"/g)].map((m) => m[1]);

const yearFile = async (year, dep) => {
  const res = await fetch(`${BASE}${year}/departements/${dep}.csv.gz`);
  if (res.status === 404) return { communes: new Map() };
  if (!res.ok) throw new Error(`${year}/${dep}: HTTP ${res.status}`);
  return pricesOfYear(createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity }));
};

const main = async () => {
  const years = (await listing(BASE)).filter((y) => /^\d{4}$/.test(y)).sort().slice(-5);
  const deps = process.argv.slice(2).length ? process.argv.slice(2)
    : (await listing(`${BASE}${years.at(-1)}/departements/`)).filter((f) => f.endsWith('.csv.gz')).map((f) => f.replace('.csv.gz', ''));
  await mkdir(OUT, { recursive: true });
  for (const dep of deps) {
    const t = Date.now();
    const perYear = await Promise.all(years.map(async (year) => ({ year: Number(year), ...(await yearFile(year, dep)) })));
    const period = [perYear.map((y) => y.from).filter(Boolean).sort()[0], perYear.map((y) => y.to).filter(Boolean).sort().at(-1)];
    const json = JSON.stringify({
      ...buildDepartment(perYear),
      _meta: { source: 'DVF géolocalisées (DGFiP, Etalab), https://files.data.gouv.fr/geo-dvf/latest/csv/', method: 'Statistiques DVF de data.gouv.fr', years: years.map(Number), period, minSales: MIN_SALES },
    });
    await writeFile(new URL(`${dep}.json`, OUT), json);
    console.log(`${dep}: ${(json.length / 1024).toFixed(0)} KB in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
};

if (import.meta.main) await main();
