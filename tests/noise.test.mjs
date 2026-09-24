import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { noiseView, gfiUrl, parseZones, PEB } from '../src/lib/noise.ts';

const zones = (kind, place) => parseZones(JSON.parse(readFileSync(new URL(`fixtures/noise-${kind}-${place}.json`, import.meta.url))));
const view = (place) => noiseView(zones('peb', place), zones('pgs', place));
const ROAD_NOTE = 'Le bruit des routes et des voies ferrées n’est pas encore affiché : ces cartes existent seulement pour les grands axes et les grandes agglomérations.';

test('asks a ±0.05° box of 1001 px, at the pixel of the point', () => {
  const p = new URL(gfiUrl(PEB, { lat: 49.030067, lon: 2.469754 })).searchParams;
  assert.equal(p.get('BBOX'), '48.980067,2.419754,49.080067,2.519754'); // lat,lon order in WMS 1.3.0 EPSG:4326
  assert.deepEqual([p.get('WIDTH'), p.get('I'), p.get('J')], ['1001', '500', '500']);
  assert.equal(p.get('QUERY_LAYERS'), 'dgac_peb_plan_wmsv');
});

test('Goussainville, rue Ronsard: zone C of the CDG PEB and zone 3 of its PGS', () => {
  const v = view('goussainville');
  assert.deepEqual(v.facts.map((f) => [f.label, f.value, f.level]), [
    ['Zone de bruit d’aéroport', 'Zone C du PEB de Paris-CDG', 'warn'],
    ['Plan de gêne sonore', 'Zone 3 du PGS de Paris-CDG', 'info'],
  ]);
  assert.match(v.facts[0].detail, /bruit modéré/);
  assert.deepEqual(v.items.map((i) => [i.name, i.detail]), [
    ['Arrêté du PEB de Paris-CDG', 'du 03/04/2007, PDF'],
    ['Arrêté du PGS de Paris-CDG', 'du 11/12/2013, PDF'],
  ]);
  assert.equal(v.precision, 'zone');
  assert.deepEqual(v.notes, [ROAD_NOTE]);
});

test('Goussainville, rue Marie Rose Madeline: zone D only', () => {
  const v = view('goussainville-madeline');
  assert.deepEqual(v.facts.map((f) => f.value), ['Zone D du PEB de Paris-CDG']);
  assert.equal(v.facts[0].level, 'info');
});

for (const place of ['segur', 'saint-veran'])
  test(`${place}: outside any airport plan, road noise still flagged as not shown`, () => {
    const v = view(place);
    assert.deepEqual(v.facts, [{ label: 'Zone de bruit d’aéroport', value: 'Hors plan d’exposition au bruit d’un aéroport', level: 'ok' }]);
    assert.equal(v.items, undefined);
    assert.deepEqual(v.notes, [ROAD_NOTE]);
    assert.match(v.explanation, /L112-7/);
  });
