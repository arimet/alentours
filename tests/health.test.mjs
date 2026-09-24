import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { finessUrl, gpUrl, nearbyFiness, parseGps, healthView, emergencyKind } from '../src/lib/health.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const SEGUR = { lat: 48.850699, lon: 2.308628 };
const VERAN = { lat: 44.704139, lon: 6.861073 };

// Serves the captured answers: first call = small bbox, second = wide bbox.
const fakeGet = (place) => {
  const calls = [];
  const get = async (url) => {
    const kind = url.includes('categ_code') ? 'pharmacy' : 'emergency';
    calls.push(url);
    const n = calls.filter((u) => u.includes('categ_code') === (kind === 'pharmacy')).length;
    return fixture(`health-finess-${kind}-${place}-${n === 1 ? 'near' : 'wide'}.json`);
  };
  return { get, calls };
};

const load = async (place, p) => {
  const { get, calls } = fakeGet(place);
  const ph = await nearbyFiness('pharmacy', p, get), emerg = await nearbyFiness('emergency', p, get);
  const view = healthView({
    pharmacies: ph.places, emergencies: emerg.places, finessDate: ph.date,
    gps: parseGps(fixture(`health-ameli-gps-${place}.json`), p),
    ameliDate: fixture('health-ameli-meta.json').metas.default.modified,
  });
  return { view, calls };
};

test('builds a bounding box around the point', () => {
  const q = new URL(finessUrl('pharmacy', SEGUR, 1.5)).searchParams;
  assert.equal(q.get('categ_code__exact'), '620');
  assert.ok(+q.get('geoloc_4326_lat__greater') < SEGUR.lat && +q.get('geoloc_4326_lat__less') > SEGUR.lat);
  assert.ok(Math.abs(+q.get('geoloc_4326_lat__less') - SEGUR.lat - 1.5 / 111.32) < 1e-4);
  assert.ok(+q.get('geoloc_4326_long__less') - SEGUR.lon > 1.5 / 111.32); // longitude degrees are shorter
  assert.equal(new URL(finessUrl('emergency', SEGUR, 15)).searchParams.get('san_urg__exact'), 'true');
  assert.match(new URL(gpUrl(SEGUR)).searchParams.get('where'), /POINT\(2.308628 48.850699\)/);
});

test('Ségur: nearest pharmacy, GP and general emergency department', async () => {
  const { view, calls } = await load('segur', SEGUR);
  assert.equal(calls.length, 2, 'no widening in Paris');
  const [ph, gp, er] = view.facts;
  assert.equal(ph.value, 'à 210 m à vol d’oiseau');
  assert.match(ph.detail, /Pharmacie Mesnard/);
  assert.equal(gp.value, 'à 50 m à vol d’oiseau');
  assert.match(gp.detail, /Ratajczak/);
  // Necker (694 m) is a children's hospital: the main fact skips it.
  assert.equal(er.value, 'à 2,3 km à vol d’oiseau');
  assert.match(er.detail, /Saint Joseph/);
  assert.ok(view.items.some((i) => /Necker/.test(i.name) && /pédiatriques/.test(i.detail)));
  assert.equal(view.source.updated, '04/05/2026');
  assert.ok(view.notes.some((n) => /Opendatasoft/.test(n) && /25\/06\/2026/.test(n)));
  assert.ok(![view.explanation, ...view.notes, ...view.facts.map((f) => f.value + f.detail)].join().includes('—'));
});

test('Saint-Véran: empty small bbox is widened once, SMUR antennas are left out', async () => {
  const { view, calls } = await load('saint-veran', VERAN);
  assert.equal(calls.length, 4);
  const [ph, gp, er] = view.facts;
  assert.equal(ph.value, 'à 8,7 km à vol d’oiseau');
  assert.equal(gp.value, 'à 8,5 km à vol d’oiseau');
  assert.equal(er.value, 'à 29 km à vol d’oiseau');
  assert.match(er.detail, /Briancon/);
  assert.ok(!view.items.some((i) => /SMUR/.test(i.name)));
});

test('GPs: one row per time slot is collapsed to one per doctor and address', () => {
  const raw = fixture('health-ameli-gps-segur.json').results;
  const gps = parseGps({ results: raw }, SEGUR);
  const keys = new Set(raw.map((r) => `${r.nom}|${r.adresse.replace(/\s+/g, ' ').trim()}`));
  assert.equal(gps.length, keys.size);
  assert.ok(gps.length < raw.length);
  assert.ok(gps.every((g, i) => i === 0 || gps[i - 1].distance <= g.distance));
});

test('emergency kinds come from the name and the medicine flag', () => {
  assert.equal(emergencyKind({ rs: 'ANTENNE SMUR MODANE', san_med: false }), 'smur');
  assert.equal(emergencyKind({ rs: 'CHRU DE TOURS - ANTENNE DE LOCHES', san_med: false }), 'smur');
  assert.equal(emergencyKind({ rs: 'GHU APHP NUP SITE ROBERT DEBRE', san_med: true }), 'paediatric');
  assert.equal(emergencyKind({ rs: 'CHRU TROUSSEAU - CHAMBRAY', san_med: true }), 'general');
  assert.equal(emergencyKind({ rs: 'CH SUD FRANCILIEN', san_med: false }), 'general');
});

test('partial failure: the rest is shown with a note', () => {
  const view = healthView({ pharmacies: undefined, gps: [], emergencies: [] });
  assert.equal(view.facts[0].level, 'unknown');
  assert.equal(view.facts[1].value, 'Aucun à moins de 50 km');
  assert.ok(view.notes.some((n) => /FINESS n’a pas répondu/.test(n)));
});

test('the nearest pharmacy on foot wins; emergencies stay as the crow flies', async () => {
  const { get } = fakeGet('segur');
  const ph = (await nearbyFiness('pharmacy', SEGUR, get)).places, emerg = (await nearbyFiness('emergency', SEGUR, get)).places;
  const pharmacies = ph.map((p, i) => (i === 0 ? { ...p, walk: { m: 900, min: 14, line: [] } } : i === 1 ? { ...p, walk: { m: 400, min: 6, line: [] } } : p));
  const view = healthView({ pharmacies, emergencies: emerg, gps: [] });
  assert.equal(view.facts[0].value, 'à 400 m à pied, 6 min');
  assert.ok(view.facts[0].detail.startsWith(ph[1].name));
  assert.equal(view.items[0].walk.m, 400);
  assert.equal(view.items[1].walk.m, 900);
  assert.equal(view.facts[2].value, 'à 2,3 km à vol d’oiseau');
  assert.match(view.explanation, /urgences, elles sont à vol d’oiseau/);
  assert.ok(view.notes.includes('Distances à pied : calcul d’itinéraire de la Géoplateforme (IGN).'));
});
