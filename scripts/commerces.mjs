// Builds public/data/commerces/<dep>.json: everyday shops and services, from the INSEE
// "Base permanente des équipements" (BPE), geolocated equipment file, Licence Ouverte.
// Run: node scripts/commerces.mjs [outDir]. Needs Node 24 and the `unzip` command (present on
// GitHub runners and macOS). No npm dependency: the CSV is streamed and split by hand below.
//
// The file (BPE25.zip, 140 MB, one 1.5 GB CSV) already has LATITUDE / LONGITUDE in WGS84 next to
// the projected LAMBERT_X / LAMBERT_Y + EPSG, so no reprojection is needed.
// It also has names, addresses and SIRET numbers: only the type and the point are kept.
//
// Geolocation quality, QUALITE_XY (BPE25_anonymisee_varmod.csv): B "Bonne", A "Acceptable",
// M "Mauvaise", _U "Indéterminée", _Z "Sans objet". Only B and A are kept: M points sit at a random
// place in the street or the commune (QUALITE_GEOLOC 12, 22, 33), which would give false distances.
// About 9 % of the boulangeries are dropped this way.

import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { departmentOf } from '../src/lib/data.ts';
import { PAD_KM } from '../src/lib/commerces.ts';

export const VINTAGE = '2025';
export const PAGE = 'https://www.insee.fr/fr/statistiques/8217525?sommaire=8217537';
const ZIP = 'https://www.insee.fr/fr/statistiques/fichier/8217525/BPE25.zip';

// Official TYPEQU codes and labels, nomenclature TYPEQU_2025.csv of the BPE 2025:
// B104 hypermarché et grand magasin · B105 supermarché et magasin multi-commerce · B201 supérette ·
// B202 épicerie · B207 boulangerie-pâtisserie · B204 boucherie charcuterie · B206 poissonnerie ·
// B208 commerce spécialisé en fruits et légumes · B324 librairie · B325 papeterie et presse ·
// A206 bureau de poste · A207 relais poste · A208 agence postale · A203 banque, caisse d'épargne ·
// B316 station-service. The BPE has no tobacconist, market or cash machine. Pharmacies are in the
// Santé block. Order matters: the index is what the points store.
export const TYPES = [
  { label: 'Boulangerie', codes: ['B207'] },
  { label: 'Supérette ou épicerie', codes: ['B201', 'B202'] },
  { label: 'Supermarché ou hypermarché', codes: ['B104', 'B105'] },
  { label: 'Boucherie, poissonnerie ou primeur', codes: ['B204', 'B206', 'B208'] },
  { label: 'Librairie ou presse', codes: ['B324', 'B325'] },
  { label: 'Bureau de poste ou relais poste', codes: ['A206', 'A207', 'A208'] },
  { label: 'Banque', codes: ['A203'] },
  { label: 'Station-service', codes: ['B316'] },
];
const INDEX = Object.fromEntries(TYPES.flatMap((t, i) => t.codes.map((c) => [c, i])));

/** One line of the semicolon CSV, quotes around text fields (a name may hold a ";"). */
export const splitLine = (line) => {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
};

/** Kept rows → { dep: [[lat, lon, type], ...] }, from lines of the CSV (header first). */
export const collect = async (lines) => {
  let col;
  const deps = {};
  for await (const line of lines) {
    if (!line) continue;
    const f = splitLine(line);
    if (!col) { col = Object.fromEntries(f.map((n, i) => [n, i])); continue; }
    const type = INDEX[f[col.TYPEQU]];
    if (type === undefined || !['A', 'B'].includes(f[col.QUALITE_XY])) continue;
    const lat = Number(f[col.LATITUDE]), lon = Number(f[col.LONGITUDE]);
    if (!f[col.LATITUDE] || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    (deps[departmentOf(f[col.DEPCOM])] ??= []).push([+lat.toFixed(5), +lon.toFixed(5), type]);
  }
  return deps;
};

/** { dep: points } → { dep: file }: its own points plus the neighbours' within PAD_KM of its box,
 * so a shop just across the border counts. Cheaper than loading the neighbouring files. */
export const buildFiles = (deps) => {
  const all = Object.entries(deps).flatMap(([dep, pts]) => pts.map((p) => [dep, p]));
  const files = {};
  for (const [dep, own] of Object.entries(deps)) {
    const lats = own.map((p) => p[0]), lons = own.map((p) => p[1]);
    const mid = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180);
    const dLat = PAD_KM / 111.2, dLon = PAD_KM / (111.2 * Math.cos(mid));
    const [s, n, w, e] = [Math.min(...lats) - dLat, Math.max(...lats) + dLat, Math.min(...lons) - dLon, Math.max(...lons) + dLon];
    const points = [...own, ...all.filter(([d, p]) => d !== dep && p[0] >= s && p[0] <= n && p[1] >= w && p[1] <= e).map(([, p]) => p)]
      .sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]); // stable output: a rerun on the same data is no diff
    files[dep] = { types: TYPES.map((t) => t.label), points, _meta: { source: `INSEE, Base permanente des équipements ${VINTAGE}`, vintage: VINTAGE, url: PAGE } };
  }
  return files;
};

const main = async () => {
  const outDir = process.argv[2] ?? 'public/data/commerces';
  const cache = process.env.CACHE_DIR ?? join(tmpdir(), 'commerces-data');
  mkdirSync(cache, { recursive: true });
  const zip = join(cache, 'BPE25.zip');
  if (!existsSync(zip)) {
    console.log(`GET ${ZIP}`);
    const res = await fetch(ZIP);
    if (!res.ok) throw new Error(`${ZIP}: HTTP ${res.status}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  const unzip = spawn('unzip', ['-p', zip]);
  const deps = await collect(createInterface({ input: unzip.stdout, crlfDelay: Infinity }));
  const files = buildFiles(deps);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [dep, file] of Object.entries(files)) writeFileSync(join(outDir, `${dep}.json`), JSON.stringify(file));
  const sizes = readdirSync(outDir).map((f) => [f, readFileSync(join(outDir, f)).length]).sort((a, b) => b[1] - a[1]);
  const total = sizes.reduce((n, [, s]) => n + s, 0);
  console.log(`${sizes.length} files, ${(total / 1e6).toFixed(1)} MB, largest ${sizes[0][0]} ${(sizes[0][1] / 1e6).toFixed(2)} MB, ${Object.values(deps).reduce((n, p) => n + p.length, 0)} points`);
};

if (import.meta.main) await main();
