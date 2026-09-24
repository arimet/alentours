import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDays, parseClimadiag, traccGrid, nearest, buildEntries, readTar, latestClimadiag } from '../scripts/climate.mjs';

// Real files: Climadiag Commune v411 (whole commune files) and TRACC-2023 TX30D rows near the
// three test communes (headers kept as published), plus their centres from geo.api.gouv.fr.
const fixture = (name) => readFileSync(new URL(`fixtures/climate-${name}`, import.meta.url), 'utf8');
const LEVELS = ['historical', 'RWL20', 'RWL27', 'RWL40'];
const tracc = Object.fromEntries(LEVELS.map((l) => [l, Object.fromEntries(['ENSmin', 'ENSq50', 'ENSmax'].map((s) => [s, fixture(`tracc-TX30D-${l}-${s}.csv`)]))]));
const climadiag = Object.fromEntries(['54395', '75056', '05157'].map((c) => [c, fixture(`climadiag-${c}.csv`)]));
const centres = Object.fromEntries(JSON.parse(fixture('communes.json')).map((c) => [c.code, c.centre.coordinates]));

test('parses the pandas Timedelta strings of TRACC into days', () => {
  assert.equal(parseDays('0 days 00:00:00'), 0);
  assert.ok(Math.abs(parseDays('11 days 22:47:59.983520504') - 11.95) < 0.001);
  assert.ok(Math.abs(parseDays('20 days 21:35:59.967041017') - 20.9) < 0.001);
  assert.equal(parseDays('nan'), null);
});

test('reads Climadiag: reference, then low, median, high at +2, +2.7 and +4 °C', () => {
  const nancy = parseClimadiag(climadiag['54395']);
  assert.deepEqual(nancy.d35, [1, 1, 2, 4, 2, 4, 6, 4, 8, 12]);
  assert.deepEqual(nancy.n20, [2, 4, 6, 10, 7, 12, 15, 17, 22, 27]);
  assert.deepEqual(nancy.hw.slice(0, 1), [2]);
  assert.equal(nancy.dry[0], 30); // summer days with dry soil
  assert.equal(nancy.dry[5], 41);
  assert.equal(parseClimadiag(climadiag['75056']).n20[5], 26);
  assert.deepEqual(parseClimadiag(climadiag['05157']).hw, [1, 2, 6, 12, 6, 12, 21, 23, 34, 50]);
});

test('TX30D on the grid: nearest cell to the commune centre, rounded days', () => {
  const grid = traccGrid(tracc);
  const cell = nearest(grid, 48.6881, 6.1734); // Nancy
  assert.equal(cell.id, '14403');
  // 1976-2005 median, then ENSmin, ENSq50, ENSmax at each warming level.
  assert.deepEqual(cell.d30, [6, 9, 12, 18, 10, 18, 22, 23, 28, 40]);
  assert.equal(nearest(grid, 48.8589, 2.347).id, '14511'); // Paris centre
  assert.equal(nearest(grid, 44.6843, 6.8924).id, '6548'); // Saint-Véran
});

test('builds compact entries by commune, Paris as a whole', () => {
  const e = buildEntries({ climadiag, grid: traccGrid(tracc), centres });
  assert.deepEqual(Object.keys(e).sort(), ['05157', '54395', '75056']);
  assert.equal(e['54395'].d30[5], 18);
  assert.equal(e['75056'].d35[0], 1);
  assert.deepEqual(e['75056'].d30, [10, 10, 15, 23, 16, 22, 29, 26, 34, 46]);
  assert.deepEqual(e['05157'].d30, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Object.keys(e['54395']).sort(), ['d30', 'd35', 'dry', 'fire', 'hw', 'n20']);
});

test('reads a tar without extracting it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'climate-'));
  writeFileSync(join(dir, '54395.csv'), climadiag['54395']);
  writeFileSync(join(dir, 'a.txt'), 'x');
  execFileSync('tar', ['-cf', join(dir, 't.tar'), '-C', dir, '54395.csv', 'a.txt'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const files = [...readTar(readFileSync(join(dir, 't.tar')))];
  assert.deepEqual(files.map((f) => f.name), ['54395.csv', 'a.txt']);
  assert.equal(files[0].data.toString(), climadiag['54395']);
});

test('picks the latest CSV tar of Climadiag Commune in the bucket listing', () => {
  const xml = ['donnees_climadiag_commune_json_v411_20260909.tar', 'donnees_climadiag_commune_v401_20260721.tar', 'donnees_climadiag_commune_v411_20260909.tar']
    .map((k) => `<Key>CLIMADIAG_COMMUNE/${k}</Key>`).join('');
  assert.deepEqual(latestClimadiag(xml), { key: 'CLIMADIAG_COMMUNE/donnees_climadiag_commune_v411_20260909.tar', version: 'v411', date: '2026-09-09' });
});
