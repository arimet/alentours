import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, parseDbf, buildEntries, byDepartment } from '../scripts/internet.mjs';

// Real rows of the T2 2026 files, trimmed to a few communes (header kept as published).
const fixture = (name) => readFileSync(new URL(`fixtures/internet-${name}`, import.meta.url));
const sources = () => ({
  fibre: parseDbf(fixture('cartefibre-2026T2.dbf')),
  best: parseCsv(fixture('mci-best.csv').toString()),
  speed: parseCsv(fixture('mci-debit.csv').toString()),
  copper: parseCsv(fixture('copper.csv').toString()),
});

test('reads the Cartefibre DBF (latin-1 names, numbers as text)', () => {
  const r = sources().fibre.find((r) => r.INSEE_COM === '05157');
  assert.equal(r.NOM_COM, 'Saint-Véran');
  assert.equal(Number(r.ftth), 431);
  assert.equal(Number(r.Locaux), 475.20322); // an estimate, rounded by buildEntries
});

test('builds compact entries keyed by INSEE code', () => {
  const e = buildEntries(sources());
  assert.deepEqual(e['05157'], { f: [431, 475], n: 465, b: { fo: 445, '4gf': 14, sat: 6 }, d: [459, 445], cu: { s: 'n' } });
  assert.deepEqual(e['97209'].cu, { s: 'p', d: '2028-01-31' });
  assert.equal(e['78334'].cu.s, 'f'); // Lévis-Saint-Nom, closed in the 2021 experiment
});

test('Paris: fibre and copper by arrondissement, statistics for the whole commune', () => {
  const e = buildEntries(sources());
  assert.deepEqual(e['75107'], { f: [56176, 57786], cu: { s: 'n' } });
  assert.equal(e['75056'].n, 1665813);
  // No whole-Paris row in Cartefibre: the arrondissements are summed (here the 1st and the 7th only).
  assert.deepEqual(e['75056'].f, [e['75101'].f[0] + 56176, e['75101'].f[1] + 57786]);
});

test('splits by department, overseas on 3 digits', () => {
  const d = byDepartment(buildEntries(sources()));
  assert.deepEqual(Object.keys(d).sort(), ['05', '75', '78', '972']);
});
