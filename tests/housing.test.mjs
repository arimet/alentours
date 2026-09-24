import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explorerUrl, housingView, isCovered, parseStats, statsUrl, uncoveredView, yearItems } from '../src/lib/housing.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const nb = (s) => s.replace(/ /g, ' '); // fr-FR thousands separator is a narrow no-break space
const visible = (v) => JSON.stringify(v);

test('queries the arrondissement code and links the explorer page', () => {
  assert.equal(new URL(statsUrl('75107')).searchParams.get('code_geo__exact'), '75107');
  assert.equal(explorerUrl('05157'), 'https://explore.data.gouv.fr/fr/immobilier?level=commune&code=05157');
});

test('Paris 7e: apartment and house medians over the period, yearly lines', () => {
  const v = housingView({ insee: '75107', district: true, stats: parseStats(fixture('housing-stats-75107.json')), dep: fixture('housing-dvf-75.json') });
  assert.deepEqual(v.facts.map((f) => nb(f.value)), ['14 312 €/m²', '25 438 €/m²', '4 629']);
  assert.equal(nb(v.facts[0].detail), 'Prix médian de 4 611 ventes de janvier 2021 à décembre 2025.');
  assert.equal(v.precision, 'à l’arrondissement');
  assert.equal(v.items.length, 5);
  assert.equal(nb(v.items[0].name + ' ' + v.items[0].detail), '2021 appartements 14 535 €/m² (943 ventes), maisons : 4 ventes, trop peu pour une médiane');
  assert.equal(v.source.url, 'https://explore.data.gouv.fr/fr/immobilier?level=commune&code=75107');
  assert.ok(!visible(v).includes('—'));
});

test('Saint-Véran: small samples, commune precision', () => {
  const v = housingView({ insee: '05157', district: false, stats: parseStats(fixture('housing-stats-05157.json')), dep: fixture('housing-dvf-05-excerpt.json') });
  assert.deepEqual(v.facts.map((f) => nb(f.value)), ['2 700 €/m²', '3 745 €/m²', '37']);
  assert.equal(v.precision, 'à la commune');
  assert.equal(nb(v.items[3].detail), 'appartements : 1 vente, trop peu pour une médiane, maisons : 2 ventes, trop peu pour une médiane');
  assert.equal(nb(v.items[4].detail), 'appartements 4 163 €/m² (7 ventes), maisons : 1 vente, trop peu pour une médiane');
});

test('without the yearly file, the evolution is omitted with a note', () => {
  const v = housingView({ insee: '05157', district: false, stats: parseStats(fixture('housing-stats-05157.json')) });
  assert.equal(v.items, undefined);
  assert.match(v.notes.at(-1), /par année n’est pas disponible/);
  assert.match(v.facts[0].detail, /sur les cinq dernières années publiées/);
});

test('few or no sales are said, not shown as a median', () => {
  const s = { appartement: { n: 3, median: 2100 }, maison: { n: 0, median: null }, total: 3 };
  const v = housingView({ insee: '05157', district: false, stats: s });
  assert.equal(v.facts[0].value, 'Trop peu de ventes');
  assert.equal(v.facts[1].value, 'Aucune vente');
  assert.deepEqual(yearItems({ years: [2025], appartement: { median: [null], n: [0] }, maison: { median: [null], n: [0] } })[0].detail, 'appartements : aucune vente, maisons : aucune vente');
});

test('Moselle, Alsace and Mayotte: not covered, no call needed', () => {
  // Metz really answers with an empty row (tests/fixtures/housing-stats-57463.json).
  assert.equal(parseStats(fixture('housing-stats-57463.json')).total, 0);
  for (const c of ['57463', '67482', '68224', '97611']) assert.equal(isCovered(c), false);
  for (const c of ['75107', '05157', '97209', '2A004']) assert.equal(isCovered(c), true);
  const v = uncoveredView();
  assert.equal(v.facts[0].level, 'unknown');
  assert.match(v.explanation, /livre foncier/);
});
