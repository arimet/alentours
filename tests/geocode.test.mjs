import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePlaces, communeCode, precisionOf } from '../src/lib/geocode.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));

test('parses a reverse-geocoding answer into places', () => {
  assert.deepEqual(parsePlaces(fixture('geocoding-reverse-segur-paris.json')), [{
    label: '20 Avenue de Ségur 75007 Paris',
    lat: 48.850699, lon: 2.308628,
    citycode: '75107', city: 'Paris', postcode: '75007', housenumber: '20', street: 'Avenue de Ségur', type: 'housenumber',
  }]);
});

test('keeps the order of autocomplete results', () => {
  const places = parsePlaces(fixture('geocoding-autocomplete-segur.json'));
  assert.equal(places[0].label, 'Rue De Segur 19100 Brive-la-Gaillarde');
  assert.equal(places[0].lon, 1.531935);
});

test('a municipality result is flagged as commune-level', () => {
  const [veran] = parsePlaces(fixture('geocoding-search-saint-veran.json'));
  assert.equal(veran.type, 'municipality');
  assert.equal(precisionOf(veran.type), 'commune');
  assert.equal(veran.street, undefined);
  assert.equal(veran.housenumber, undefined);
});

test('empty or malformed answers give no places', () => {
  assert.deepEqual(parsePlaces({ features: [] }), []);
  assert.deepEqual(parsePlaces({}), []);
  assert.deepEqual(parsePlaces(null), []);
});

test('maps Paris, Lyon and Marseille districts to their commune', () => {
  assert.equal(communeCode('75107'), '75056');
  assert.equal(communeCode('75120'), '75056');
  assert.equal(communeCode('69381'), '69123');
  assert.equal(communeCode('13216'), '13055');
  assert.equal(communeCode('05157'), '05157');
  assert.equal(communeCode('75056'), '75056');
});

test('precision follows the result type', () => {
  assert.equal(precisionOf('housenumber'), 'adresse');
  assert.equal(precisionOf('street'), 'rue');
  assert.equal(precisionOf('locality'), 'lieu-dit');
});

test('drops the district the geocoder appends after a comma', () => {
  const [p] = parsePlaces({ features: [{ geometry: { coordinates: [4.835391, 45.761307] }, properties: { label: 'Rue de la République 69002 Lyon,Lyon 2e Arrondissement', citycode: '69382', city: 'Lyon', postcode: '69002', type: 'street' } }] });
  assert.equal(p.label, 'Rue de la République 69002 Lyon');
});
