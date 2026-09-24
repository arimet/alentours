import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitLine, collect, buildFiles, TYPES } from '../scripts/commerces.mjs';

// Real rows of BPE25.csv around each address (names, addresses and SIRET blanked), plus 3 pharmacies.
const lines = (name) => readFileSync(new URL(`fixtures/commerces-${name}.csv`, import.meta.url), 'utf8').split('\n');

test('splits quoted fields, a ";" inside quotes included', () => {
  assert.deepEqual(splitLine('"a;b";"";12;"say ""hi"""'), ['a;b', '', '12', 'say "hi"']);
});

test('keeps everyday shops with a good or acceptable geolocation, rounded to 5 decimals', async () => {
  const d = await collect(lines('nancy'));
  assert.deepEqual(Object.keys(d), ['54']);
  const rows = lines('nancy').slice(1).filter(Boolean).map(splitLine);
  const head = splitLine(lines('nancy')[0]), col = (n) => head.indexOf(n);
  const expected = rows.filter((f) => f[col('TYPEQU')] !== 'D307' && ['A', 'B'].includes(f[col('QUALITE_XY')]));
  assert.equal(d['54'].length, expected.length);
  assert.ok(rows.length > expected.length); // pharmacies and "Mauvaise" points are left out
  for (const [lat, lon, t] of d['54']) {
    assert.ok(Math.abs(lat - 48.7) < 0.1 && Math.abs(lon - 6.16) < 0.1);
    assert.equal(lat, +lat.toFixed(5));
    assert.ok(TYPES[t]);
  }
});

test('overseas departments on 3 digits', async () => {
  assert.deepEqual(Object.keys(await collect(lines('fort-de-france'))), ['972']);
});

test('a department file holds the neighbours near its border, sorted, without a timestamp', async () => {
  // Around Saint-Véran, a few points lie in the Alpes-de-Haute-Provence (04).
  const d = await collect(lines('saint-veran'));
  assert.ok(d['04']?.length && d['05']?.length);
  const f = buildFiles(d);
  assert.deepEqual(f['05'].types, TYPES.map((t) => t.label));
  assert.ok(f['05'].points.length >= d['05'].length);
  assert.ok(f['05'].points.length <= d['05'].length + d['04'].length);
  assert.deepEqual(f['05'].points, [...f['05'].points].sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]));
  assert.deepEqual(f['05']._meta, { source: 'INSEE, Base permanente des équipements 2025', vintage: '2025', url: 'https://www.insee.fr/fr/statistiques/8217525?sommaire=8217537' });
});
