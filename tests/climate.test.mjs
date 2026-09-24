import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEntries, traccGrid } from '../scripts/climate.mjs';
import { climateView } from '../src/lib/climate.ts';

// The department files as the script writes them, from the real Climadiag v411 and TRACC-2023 rows.
const fixture = (name) => readFileSync(new URL(`fixtures/climate-${name}`, import.meta.url), 'utf8');
const tracc = Object.fromEntries(['historical', 'RWL20', 'RWL27', 'RWL40'].map((l) => [l, Object.fromEntries(['ENSmin', 'ENSq50', 'ENSmax'].map((s) => [s, fixture(`tracc-TX30D-${l}-${s}.csv`)]))]));
const file = {
  ...buildEntries({
    climadiag: Object.fromEntries(['54395', '75056', '05157'].map((c) => [c, fixture(`climadiag-${c}.csv`)])),
    grid: traccGrid(tracc),
    centres: Object.fromEntries(JSON.parse(fixture('communes.json')).map((c) => [c.code, c.centre.coordinates])),
  }),
  _meta: { version: 'v411', date: '2026-09-09' },
};
const ctx = (citycode, commune = citycode) => ({ citycode, commune, lat: 0, lon: 0, label: '', city: '' });
const visible = (v) => [v.explanation, v.precision, ...(v.notes ?? []).map((n) => (typeof n === 'string' ? n : n.text)), ...v.facts.flatMap((f) => [f.label, f.value, f.detail ?? ''])].join('\n');

test('Nancy: four heat facts, reference 1976-2005 and 2050 in the value, other horizons in the detail', () => {
  const v = climateView(file, ctx('54395'));
  assert.deepEqual(v.facts.map((f) => f.label), ['Jours à 30 °C ou plus', 'Jours à 35 °C ou plus', 'Nuits à plus de 20 °C', 'Jours de vague de chaleur']);
  assert.ok(v.facts.every((f) => f.level === 'info'));
  assert.equal(v.facts[0].value, '6 par an en 1976-2005, 18 vers 2050');
  assert.equal(v.facts[0].detail, 'Vers 2030 (+2 °C) : 12 par an. Vers 2100 (+4 °C) : 28 par an. Selon les modèles, entre 10 et 22 vers 2050.');
  assert.equal(v.facts[1].value, '1 par an en 1976-2005, 4 vers 2050');
  assert.equal(v.facts[2].value, '2 par an en 1976-2005, 12 vers 2050');
  assert.equal(v.facts[3].detail, 'Vers 2030 (+2 °C) : 8 par an. Vers 2100 (+4 °C) : 22 par an. Selon les modèles, entre 10 et 18 vers 2050.');
  assert.equal(v.precision, 'à la commune');
  assert.deepEqual(v.source, { name: 'Météo-France, Climadiag Commune et DRIAS (Explore2, TRACC-2023)', url: 'https://meteofrance.com/climadiag-commune', updated: 'version du 09/09/2026' });
});

test('the TRACC horizons and the limits are said in plain French', () => {
  const t = visible(climateView(file, ctx('54395')));
  assert.match(t, /Trajectoire de réchauffement de référence pour l’adaptation au changement climatique \(TRACC\)/);
  assert.match(t, /\+2 °C vers 2030, \+2,7 °C vers 2050 et \+4 °C vers 2100/);
  assert.match(t, /pas une prévision pour votre rue/);
  assert.match(t, /médiane de plusieurs modèles/);
  assert.doesNotMatch(t, /—/);
});

test('Paris 7e reads the whole commune of Paris', () => {
  const v = climateView(file, ctx('75107', '75056'));
  assert.equal(v.facts[0].value, '10 par an en 1976-2005, 22 vers 2050');
  assert.equal(v.facts[2].value, '8 par an en 1976-2005, 26 vers 2050');
  assert.match(visible(v), /ensemble de Paris/);
});

test('Saint-Véran: no hot day at 2 000 m, heatwaves still counted', () => {
  const v = climateView(file, ctx('05157'));
  assert.equal(v.facts[0].value, '0 par an en 1976-2005, 0 vers 2050');
  assert.equal(v.facts[0].detail, 'Vers 2030 (+2 °C) : 0 par an. Vers 2100 (+4 °C) : 0 par an.');
  assert.equal(v.facts[3].value, '1 par an en 1976-2005, 12 vers 2050');
});

test('a commune without data (overseas) says so', () => {
  const v = climateView({}, ctx('97411'));
  assert.equal(v.facts.length, 1);
  assert.equal(v.facts[0].level, 'unknown');
  assert.match(visible(v), /Hexagone et la Corse/);
});
