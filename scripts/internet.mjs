// Builds public/data/internet/<dep>.json: fixed internet at the commune, from Arcep open data.
// Run: node scripts/internet.mjs [outDir]. Needs Node 24 and the `unzip` command (present on
// GitHub runners and macOS). No npm dependency: CSV and DBF are parsed by hand below.
//
// Sources, all under Licence Ouverte:
// - Cartefibre commune (Arcep, data.gouv.fr): FttH premises "raccordables" / total premises.
//   Paris, Lyon and Marseille are split in arrondissements (75107…), no whole-commune row.
// - Ma connexion internet, statistiques communales (Arcep): best technology and speed classes.
//   Paris, Lyon and Marseille only as whole communes (75056, 69123, 13055).
// - Fermeture du réseau cuivre (economie.gouv.fr, from Orange's schedule): by arrondissement in
//   Paris, Lyon and Marseille; INSEE codes lose their leading zero (5157 = 05157).
// Every source uses the current commune codes, so a commune nouvelle has one entry under its new
// code, like the geocoder returns. The block reads the arrondissement entry for the fibre and the
// copper schedule, and the whole-commune entry for the rest.

import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { departmentOf } from '../src/lib/data.ts';

const MCI = 'https://data.arcep.fr/fixe/maconnexioninternet/statistiques/last/commune';
const CARTEFIBRE = 'https://www.data.gouv.fr/api/1/datasets/le-marche-du-haut-et-tres-haut-debit-fixe-deploiements/';
const CUIVRE = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fermeture-reseau-cuivre';

/** Semicolon CSV without quoted separators (true of the Arcep and ODS exports used here). */
export const parseCsv = (text) => {
  const [head, ...lines] = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const cols = head.split(';');
  return lines.map((l) => Object.fromEntries(l.split(';').map((v, i) => [cols[i], v])));
};

/** dBase III table (the .dbf of a shapefile), latin-1 as Arcep writes it despite its .cpg. */
export const parseDbf = (buf) => {
  const count = buf.readUInt32LE(4), headLen = buf.readUInt16LE(8), recLen = buf.readUInt16LE(10);
  const fields = [];
  for (let o = 32; buf[o] !== 0x0d; o += 32)
    fields.push({ name: buf.toString('latin1', o, o + 11).replace(/\0.*$/, ''), len: buf[o + 16] });
  const rows = [];
  for (let r = 0; r < count; r++) {
    let o = headLen + r * recLen;
    if (buf[o++] === 0x2a) continue; // deleted
    const row = {};
    for (const f of fields) { row[f.name] = buf.toString('latin1', o, o + f.len).trim(); o += f.len; }
    rows.push(row);
  }
  return rows;
};

/** Arrondissement code → whole-commune code, for Paris, Lyon and Marseille. */
const PLM = (code) => (/^751\d\d$/.test(code) ? '75056' : /^6938\d$/.test(code) ? '69123' : /^132\d\d$/.test(code) ? '13055' : undefined);

const int = (v) => Math.round(Number(v)) || 0;

const CUIVRE_STATUS = (msg) => (/déjà fermé/.test(msg) ? 'f' : /pas encore prévu/.test(msg) ? 'n' : 'p');

/**
 * Compact entries by INSEE code.
 * f: [FttH raccordables, locaux] (Cartefibre) · n: locaux (MCI) · b: locaux by best technology (MCI, THD ranking)
 * d: [≥ 30 Mbit/s, ≥ 1 Gbit/s] locaux by wired or terrestrial radio access, satellite excluded (MCI)
 * cu: copper closure { s: 'p' planned | 'f' closed | 'n' not planned yet, d?: technical closure date }
 */
export const buildEntries = ({ fibre, best, debit, cuivre }) => {
  const out = {};
  const at = (code) => (out[code] ??= {});
  for (const r of fibre) {
    const f = [int(r.ftth), int(r.Locaux)];
    at(r.INSEE_COM).f = f;
    // Cartefibre has no whole-commune row for Paris, Lyon and Marseille: sum the arrondissements.
    const whole = PLM(r.INSEE_COM);
    if (whole) { const w = (at(whole).f ??= [0, 0]); w[0] += f[0]; w[1] += f[1]; }
  }
  for (const r of best) {
    const b = { fo: int(r.elig_ftth), coax: int(r.elig_coax), cu: int(r.elig_cu_30) + int(r.elig_cu_8), thdr: int(r.elig_thdr), '4gf': int(r.elig_4gf), hdr: int(r.elig_hdr), sat: int(r.elig_sat) };
    Object.assign(at(r.code_insee), { n: int(r.nbr), b: Object.fromEntries(Object.entries(b).filter(([, v]) => v)) });
  }
  for (const r of debit) at(r.code_insee).d = [int(r.elig_thd30), int(r.elig_thd1g)];
  for (const r of cuivre) {
    const code = r.code_insee.padStart(5, '0');
    if (!/^\d[\dAB]\d{3}$/.test(code) || code === '00000') continue;
    const s = CUIVRE_STATUS(r.output_usager);
    at(code).cu = s === 'n' || !r.fermeture_technique ? { s } : { s, d: r.fermeture_technique };
  }
  return out;
};

/** Splits the entries in one object per department. */
export const byDepartment = (entries) => {
  const deps = {};
  for (const [code, e] of Object.entries(entries)) (deps[departmentOf(code)] ??= {})[code] = e;
  return deps;
};

const main = async () => {
  const outDir = process.argv[2] ?? 'public/data/internet';
  const cache = process.env.CACHE_DIR ?? join(tmpdir(), 'internet-data');
  mkdirSync(cache, { recursive: true });
  const get = async (url, name) => {
    const file = join(cache, name);
    if (!existsSync(file)) {
      console.log(`GET ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    return readFileSync(file);
  };
  const json = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };

  // Cartefibre: the latest "<year>T<n>-Commune" resource.
  const ds = await json(CARTEFIBRE);
  const res = ds.resources.filter((r) => /^\d{4}T\d-Commune$/i.test(r.title)).sort((a, b) => b.title.localeCompare(a.title))[0];
  const quarter = res.title.slice(0, 6).toUpperCase(); // 2026T2
  await get(res.url, `cartefibre-${quarter}.zip`);
  const zip = join(cache, `cartefibre-${quarter}.zip`);
  const dbfName = execFileSync('unzip', ['-Z1', zip]).toString().split('\n').find((n) => n.endsWith('.dbf'));
  const fibre = parseDbf(execFileSync('unzip', ['-p', zip, dbfName], { maxBuffer: 1 << 30 }));

  const best = parseCsv((await get(`${MCI}/commune_meilleure_techno_thd.csv`, 'mci-best.csv')).toString());
  const debit = parseCsv((await get(`${MCI}/commune_debit_terrestre.csv`, 'mci-debit.csv')).toString());
  const cuivre = parseCsv((await get(`${CUIVRE}/exports/csv?delimiter=%3B&select=code_insee,fermeture_technique,output_usager`, 'cuivre.csv')).toString());
  const cuivreMeta = await json(CUIVRE);

  const mciDate = best[0].date; // 2026-06-30
  const [y, q] = [quarter.slice(0, 4), quarter.slice(5)];
  const _meta = {
    sources: [
      { name: `Arcep, Cartefibre (déploiements FttH), T${q} ${y}`, url: 'https://www.data.gouv.fr/datasets/le-marche-du-haut-et-tres-haut-debit-fixe-deploiements', date: res.last_modified.slice(0, 10) },
      { name: `Arcep, Ma connexion internet, données au ${mciDate.split('-').reverse().join('/')}`, url: 'https://www.data.gouv.fr/datasets/ma-connexion-internet', date: mciDate },
      { name: 'Fermeture du réseau cuivre (ministère de l’Économie, d’après Orange)', url: 'https://www.data.gouv.fr/datasets/fermeture-du-reseau-cuivre', date: cuivreMeta.metas.default.modified.slice(0, 10) },
    ],
  };

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const deps = byDepartment(buildEntries({ fibre, best, debit, cuivre }));
  for (const [dep, entries] of Object.entries(deps)) writeFileSync(join(outDir, `${dep}.json`), JSON.stringify({ ...entries, _meta }));
  const total = readdirSync(outDir).reduce((n, f) => n + readFileSync(join(outDir, f)).length, 0);
  console.log(`${Object.keys(deps).length} files, ${(total / 1e6).toFixed(1)} MB, ${Object.values(deps).reduce((n, d) => n + Object.keys(d).length, 0)} communes`);
};

if (import.meta.main) await main();
