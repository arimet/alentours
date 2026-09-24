import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { irveUrl, nearbyStations, chargersView } from '../src/lib/chargers.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/chargers-${name}.json`, import.meta.url)));
const NANCY = { lat: 48.703193, lon: 6.16209 };
const SEGUR = { lat: 48.850699, lon: 2.308628 };
const VERAN = { lat: 44.704139, lon: 6.861073 };

// Serves captured pages; `empty` makes the small bbox return nothing (to test widening).
const fakeGet = (place, { empty = false } = {}) => {
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    const u = new URL(url), page = u.searchParams.get('page') ?? '1';
    const km = Math.round((+u.searchParams.get('consolidated_latitude__less') - +u.searchParams.get('consolidated_latitude__greater')) * 111.32 / 2);
    if (km === 1 && empty) return { data: [], links: { next: null } };
    return fixture(`${place}-${km}km-p${page}`);
  };
  return { get, calls };
};

const load = async (place, p, opts) => {
  const { get, calls } = fakeGet(place, opts);
  const r = await nearbyStations(p, get);
  return { r, view: chargersView(r), calls };
};

test('builds a bounding box around the point', () => {
  const q = new URL(irveUrl(SEGUR, 1)).searchParams;
  assert.ok(Math.abs(+q.get('consolidated_latitude__less') - SEGUR.lat - 1 / 111.32) < 1e-4);
  assert.ok(+q.get('consolidated_longitude__less') - SEGUR.lon > 1 / 111.32);
  assert.equal(q.get('page_size'), '200');
});

test('Ségur: follows pages, dedupes charge points and groups them into stations', async () => {
  const { r, view, calls } = await load('segur', SEGUR);
  assert.equal(calls.length, 2, '352 rows = 2 pages');
  assert.equal(r.stations.length, 33);
  const [nearest, count, power] = view.facts;
  assert.equal(nearest.value, 'à 130 m à vol d’oiseau');
  assert.match(nearest.detail, /Avenue de Saxe 10/);
  assert.equal(count.value, '24');
  assert.equal(power.value, 'jusqu’à 22 kW');
  assert.equal(view.items.length, 8);
  assert.ok(view.items.every((i) => i.at && Number.isFinite(i.at.lat)));
  assert.match(view.items[0].detail, /Belib', 3 points de charge, jusqu’à 22 kW, accès libre, gratuité non renseignée/);
  assert.equal(view.source.updated, '23/09/2026');
  assert.equal(view.precision, 'au point');
  assert.ok(![view.explanation, ...view.notes, ...view.facts.map((f) => f.value + f.detail), ...view.items.map((i) => i.name + i.detail)].join().includes('—'));
});

test('Nancy: keeps the latest version of a charge point, hides technical ids', async () => {
  const { view } = await load('nancy', NANCY);
  const u = view.items.find((i) => /Système U/.test(i.name));
  assert.match(u.detail, /Power Dot France, 7 points de charge, jusqu’à 200 kW/); // 100 kW in 2025, 200 in 2026
  const yes = view.items[0];
  assert.doesNotMatch(yes.name + yes.detail, /FR\*|\//);
  assert.match(yes.detail, /^YES55, 2 points/);
  assert.equal(view.facts[2].value, 'jusqu’à 200 kW');
});

test('Saint-Véran: fewer than 3 stations nearby, so the box widens step by step', async () => {
  const { r, view, calls } = await load('saint-veran', VERAN);
  assert.equal(calls.length, 3); // 1 km, 3 km, 10 km
  assert.equal(r.stations.length, 7);
  assert.match(view.facts[0].detail, /Parking Beauregard/);
  const wide = await load('saint-veran', VERAN, { empty: true });
  assert.equal(wide.calls.length, 3);
  assert.equal(wide.r.stations.length, 7);
});

test('walking distance is used when routed; failure and emptiness are said plainly', () => {
  const s = { lat: 1, lon: 1, name: 'A', points: 1, distance: 900, walk: { m: 1200, min: 15, line: [] } };
  const v = chargersView({ stations: [s] });
  assert.equal(v.facts[0].value, 'à 1,2 km à pied, 15 min');
  assert.deepEqual(v.items[0].walk, s.walk);
  assert.equal(chargersView({}).facts[0].level, 'unknown');
  assert.equal(chargersView({ stations: [] }).facts[0].value, 'Aucune à moins de 10 km');
});
