import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pricesOfYear, buildDepartment, median, parseLine, MIN_SALES } from '../scripts/dvf.mjs';

// Real geo-dvf rows of Saint-Véran (05157), 2021 to 2025, reduced to the columns the method uses;
// mutation and parcel ids are replaced by aliases so no sale can be traced back.
const YEARS = [2021, 2022, 2023, 2024, 2025];
const lines = (y) => readFileSync(new URL(`fixtures/immobilier-geodvf-05157-${y}.csv`, import.meta.url), 'utf8').split('\n');
const perYear = await Promise.all(YEARS.map(async (year) => ({ year, ...(await pricesOfYear(lines(year))) })));

test('whole period matches the official Statistiques DVF of Saint-Véran', () => {
  // tests/fixtures/immobilier-stats-05157.json: 26 apartments at 2 700 €/m², 11 houses at 3 745 €/m².
  const official = JSON.parse(readFileSync(new URL('fixtures/immobilier-stats-05157.json', import.meta.url))).data[0];
  const all = (kind) => perYear.flatMap((y) => y.communes.get('05157')?.[kind] ?? []);
  assert.equal(all('appartement').length, official.nb_ventes_whole_appartement);
  assert.equal(median(all('appartement')), official.med_prix_m2_whole_appartement);
  assert.equal(all('maison').length, official.nb_ventes_whole_maison);
  assert.equal(median(all('maison')), official.med_prix_m2_whole_maison);
});

test('yearly series, medians hidden below the minimum sample', () => {
  const d = buildDepartment(perYear)['05157'];
  assert.deepEqual(d.years, YEARS);
  assert.equal(d.appartement.n.reduce((a, b) => a + b), 26);
  d.appartement.n.forEach((n, i) => assert.equal(d.appartement.median[i] === null, n < MIN_SALES));
  assert.ok(d.maison.median.every((m) => m === null)); // 11 houses over 5 years: never 5 in one year
  assert.ok(d.appartement.median.some((m) => m !== null));
});

test('period of the release', () => {
  assert.match(perYear[0].from, /^2021-/);
  assert.match(perYear[4].to, /^2025-12/);
});

test('pandas-like median and quoted CSV', () => {
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3); // 2.5 rounded
  assert.equal(median([]), null);
  assert.deepEqual(parseLine('a,"b, c",,"d ""e"""'), ['a', 'b, c', '', 'd "e"']);
});
