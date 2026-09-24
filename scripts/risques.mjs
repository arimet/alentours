// Pre-computes commune-level risk facts into public/data/risques/<department>.json, the fallback of the
// "Risques" block when the Géorisques API does not answer. Plain Node 24, no dependency: the GASPAR zip
// is read with the system `unzip` (present on macOS and GitHub's ubuntu runners).
// Sources: docs/feasibility/geo-risques-eau.md, section 5. No official national file gives the seismic
// zone per commune (only departmental DDT layers and a private wpd shapefile), so it stays live-only.
// Usage: node scripts/risques.mjs [folder with gaspar.zip and radon.csv already downloaded]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { departmentOf } from '../src/lib/data.ts';

const GASPAR = 'https://files.georisques.fr/GASPAR/gaspar.zip';
const RADON = 'https://static.data.gouv.fr/resources/connaitre-le-potentiel-radon-de-ma-commune/20190506-174309/radon.csv';
export const CATNAT_YEARS = 30;
const OUT = new URL('../public/data/risques/', import.meta.url);

/** One `;` CSV line, with "quoted ; fields". */
export const splitLine = (line) => {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
};

/** CSV text → array of objects keyed by header. */
export const parseCsv = (text) => {
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const keys = splitLine(head);
  return lines.map((l) => Object.fromEntries(splitLine(l).map((v, i) => [keys[i], v.trim()])));
};

/** Builds { insee: { radon, risques, pprn, pprt, catnat } } from the parsed tables. */
export const build = ({ radon, ddrm, pprn, pprt, catnat }, today = new Date()) => {
  const out = {};
  const at = (code) => (out[code] ??= {});
  // The radon CSV lost the leading zero of departments 01 to 09 (5157 for 05157).
  for (const r of radon) if (r.insee_com && /^[123]$/.test(r.classe_potentiel)) at(r.insee_com.padStart(5, '0')).radon = Number(r.classe_potentiel);
  // DDRM (code de l'environnement R125-11): keep the main categories (2-digit codes), not the sub-types.
  for (const r of ddrm) if (/^\d\d$/.test(r.num_risque)) (at(r.cod_commune).risques ??= []).includes(r.lib_risque) || at(r.cod_commune).risques.push(r.lib_risque);
  // Prevention plans still in force or being drawn up; "Caduque" ones (abrogated, annulled) are dropped.
  for (const [key, rows] of [['pprn', pprn], ['pprt', pprt]]) for (const r of rows) {
    if (!['Opposable', 'Prescrit'].includes(r['LIBELLE ETAT'])) continue;
    const list = (at(r['CODE INSEE COMMUNE'])[key] ??= []);
    if (!list.some((p) => p.nom === r['LIBELLE PROCEDURE'])) list.push({ nom: r['LIBELLE PROCEDURE'], etat: r['LIBELLE SOUS-ETAT'] });
  }
  // Catastrophe naturelle recognitions (code des assurances L125-1): one row per arrêté and peril.
  const since = `${today.getFullYear() - CATNAT_YEARS}${today.toISOString().slice(4, 10)}`;
  const seen = new Set();
  for (const r of catnat) {
    const date = r.date_debut.slice(0, 10), key = `${r.id_gaspar};${r.code_commune};${r.num_risque_jo};${date}`;
    if (date < since || seen.has(key)) continue;
    seen.add(key);
    const c = (at(r.code_commune).catnat ??= { n: 0, depuis: since, dernier: '', type: '' });
    c.n++;
    if (date > c.dernier) Object.assign(c, { dernier: date, type: r.lib_risque_jo });
  }
  return out;
};

const unzip = (zip, name) => execFileSync('unzip', ['-p', zip, name], { maxBuffer: 1 << 28 }).toString('utf8');

if (import.meta.main) {
  const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'risques-'));
  const get = async (url, file) => {
    const path = join(dir, file);
    if (existsSync(path)) return path;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    return path;
  };
  const zip = await get(GASPAR, 'gaspar.zip');
  const radonCsv = readFileSync(await get(RADON, 'radon.csv'), 'utf8');
  const names = execFileSync('unzip', ['-Z1', zip]).toString().split('\n');
  const member = (prefix) => names.find((n) => n.startsWith(prefix)) ?? (() => { throw new Error(`${prefix} missing in GASPAR zip`); })();
  const gasparDate = member('catnat_gaspar_').match(/\d{4}-\d{2}-\d{2}/)[0];
  const table = (prefix) => parseCsv(unzip(zip, member(prefix)));
  const data = build({
    radon: parseCsv(radonCsv), ddrm: table('ddrm_risq_gaspar_'), pprn: table('pprn_gaspar_'), pprt: table('pprt_gaspar_'), catnat: table('catnat_gaspar_'),
  });

  const _meta = {
    sources: [
      { name: 'Base GASPAR (ministère de la Transition écologique, Géorisques)', url: 'https://www.data.gouv.fr/datasets/base-nationale-de-gestion-assistee-des-procedures-administratives-relatives-aux-risques-gaspar', date: gasparDate },
      { name: 'Potentiel radon des communes (ASN, ex-IRSN)', url: 'https://www.data.gouv.fr/datasets/connaitre-le-potentiel-radon-de-ma-commune', date: '2019-05-06' },
    ],
    generated: new Date().toISOString().slice(0, 10),
  };
  const byDep = {};
  for (const code of Object.keys(data).sort()) if (/^\d[\dAB]\d{3}$/.test(code)) (byDep[departmentOf(code)] ??= {})[code] = data[code];
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  let total = 0;
  for (const [dep, communes] of Object.entries(byDep)) {
    const json = JSON.stringify({ ...communes, _meta });
    writeFileSync(new URL(`${dep}.json`, OUT), json);
    total += Buffer.byteLength(json);
  }
  if (!process.argv[2]) rmSync(dir, { recursive: true, force: true });
  console.log(`${Object.keys(byDep).length} departments, ${Object.keys(data).length} communes, ${(total / 1e6).toFixed(1)} MB`);
}
