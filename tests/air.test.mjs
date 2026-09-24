import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { airView, indexUrl, parseIndices } from '../src/lib/air.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/air-${name}.json`, import.meta.url)));
const view = (name, today = '2026-09-24') => airView(parseIndices(fixture(name)), today);

test('filters on the commune code, with encoded quotes', () => {
  const u = indexUrl('75107');
  assert.match(u, /CQL_FILTER=code_zone%3D%2775107%27/);
  assert.match(u, /typeNames=ind%3Aind_atmo_2021/);
});

test('Ségur: the Paris district has its own index, tomorrow not yet published', () => {
  const v = view('segur');
  assert.deepEqual(v.facts.map((f) => [f.label, f.value, f.level]), [
    ['Aujourd’hui', 'Moyen (2 sur 6)', 'info'],
    ['Demain', 'Pas encore publié', 'unknown'],
  ]);
  assert.equal(v.facts[0].detail, 'Polluants qui fixent l’indice : ozone et particules PM10.');
  assert.equal(v.precision, 'à la commune (Paris 7e Arrondissement)');
  assert.equal(v.source.name, 'Airparif, réseau Atmo France (licence ODbL)');
  assert.equal(v.source.updated, '24/09/2026');
  assert.match(v.explanation, /ne dit pas l’exposition moyenne sur l’année/);
});

test('Saint-Véran: today and tomorrow, set by ozone', () => {
  const v = view('saint-veran');
  assert.deepEqual(v.facts.map((f) => [f.label, f.value, f.level, f.detail]), [
    ['Aujourd’hui', 'Dégradé (3 sur 6)', 'warn', 'Polluant qui fixe l’indice : ozone.'],
    ['Demain', 'Dégradé (3 sur 6)', 'warn', 'Polluant qui fixe l’indice : ozone.'],
  ]);
  assert.match(v.source.name, /^AtmoSud/);
});

test('Goussainville and Paris as a whole', () => {
  assert.equal(view('goussainville').facts[0].detail, 'Polluant qui fixe l’indice : ozone.');
  assert.match(view('paris').facts[0].detail, /dioxyde d’azote, ozone, particules PM10 et particules fines PM2,5/);
});

test('stale or missing data is said as such', () => {
  const stale = view('segur', '2026-09-26');
  assert.deepEqual(stale.facts.map((f) => f.label), ['Dernier indice (24/09/2026)']);
  const none = airView([], '2026-09-24');
  assert.equal(none.facts[0].value, 'Pas d’indice publié pour cette commune');
  assert.equal(none.facts[0].level, 'unknown');
});

test('only the official six classes, the rest is unknown', () => {
  const [bad] = parseIndices({ features: [{ properties: { date_ech: '2026-09-24', code_qual: 7, lib_qual: 'Evénement', lib_zone: 'X' } }] });
  assert.deepEqual(airView([bad], '2026-09-24').facts[0], { label: 'Aujourd’hui', value: 'Evénement', level: 'unknown' });
  const [worst] = parseIndices({ features: [{ properties: { date_ech: '2026-09-24', code_qual: 6, code_pm10: 6, lib_zone: 'X' } }] });
  assert.equal(airView([worst], '2026-09-24').facts[0].value, 'Extrêmement mauvais (6 sur 6)');
});
