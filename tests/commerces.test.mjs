import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collect, buildFiles } from '../scripts/commerces.mjs';
import { candidates, commercesView } from '../src/lib/commerces.ts';

// Department files as the script writes them, from real BPE 2025 rows (tests/fixtures/commerces-*).
const file = async (name, dep) => buildFiles(await collect(readFileSync(new URL(`fixtures/commerces-${name}.csv`, import.meta.url), 'utf8').split('\n')))[dep];
const NANCY = { lat: 48.703193, lon: 6.16209 };
const SAINT_VERAN = { lat: 44.704139, lon: 6.861073 };
const FORT_DE_FRANCE = { lat: 14.603312, lon: -61.069095 };
const visible = (v) => [v.explanation, v.precision, v.source.name, ...(v.notes ?? []), ...v.facts.flatMap((f) => [f.label, f.value, f.detail ?? '']), ...(v.items ?? []).flatMap((i) => [i.name, i.detail ?? ''])].join('\n');

test('Nancy, 35 rue Joseph Mougin: a bakery close by, post office and bank a little further', async () => {
  const v = commercesView(await file('nancy', '54'), NANCY);
  assert.deepEqual(v.facts.map((f) => f.label), ['Commerce alimentaire le plus proche', 'Bureau de poste ou relais poste', 'Banque', 'Commerces et services à moins de 500 m']);
  assert.equal(v.facts[0].value, 'Boulangerie à 90 m à vol d’oiseau');
  assert.equal(v.facts[0].detail, 'Supérette ou épicerie à 530 m à vol d’oiseau ; supermarché ou hypermarché à 620 m à vol d’oiseau.');
  assert.equal(v.facts[1].value, 'À 650 m à vol d’oiseau');
  assert.equal(v.facts[2].value, 'À 650 m à vol d’oiseau');
  assert.equal(v.facts[3].value, '2');
  assert.equal(v.items.length, 8);
  assert.deepEqual(v.items[0], { name: 'Boulangerie', distance: v.items[0].distance, at: v.items[0].at });
  assert.ok(v.items.every((i, k) => k === 0 || i.distance >= v.items[k - 1].distance)); // nearest first
  assert.ok(v.items.every((i) => Number.isFinite(i.at.lat) && Number.isFinite(i.at.lon)));
  assert.equal(v.precision, 'au point (équipements géolocalisés)');
  assert.equal(v.source.name, 'INSEE, Base permanente des équipements 2025');
  assert.equal(v.source.url, 'https://www.insee.fr/fr/statistiques/8217525?sommaire=8217537');
  assert.match(v.explanation, /vol d’oiseau/);
  assert.match(v.explanation, /une fois par an/);
});

test('Saint-Véran: a small shop in the village, the supermarket and the bank far down the valley', async () => {
  const v = commercesView(await file('saint-veran', '05'), SAINT_VERAN);
  assert.equal(v.facts[0].value, 'Supérette ou épicerie à 630 m à vol d’oiseau');
  assert.equal(v.facts[1].value, 'À 810 m à vol d’oiseau');
  assert.equal(v.facts[2].value, 'À 17 km à vol d’oiseau');
  assert.equal(v.facts[3].value, 'Aucun');
  assert.ok(v.notes.some((n) => /autre département/.test(n))); // some distances exceed the 3 km margin
});

test('Fort-de-France: many shops around', async () => {
  const v = commercesView(await file('fort-de-france', '972'), FORT_DE_FRANCE);
  assert.equal(v.facts[0].value, 'Boulangerie à 130 m à vol d’oiseau');
  assert.equal(v.facts[2].value, 'À 40 m à vol d’oiseau');
  assert.equal(v.facts[3].value, '49');
  assert.ok(!v.notes.some((n) => /autre département/.test(n)));
});

test('a category absent from the file says so, an empty file too', async () => {
  const f = await file('nancy', '54');
  const v = commercesView({ ...f, points: f.points.filter((p) => p[2] !== 6) }, NANCY);
  assert.equal(v.facts[2].value, 'Aucune trouvée à proximité');
  assert.equal(v.items.length, 7);
  const empty = commercesView({}, NANCY);
  assert.deepEqual(empty.facts, [{ label: 'Commerces et services', value: 'Donnée indisponible pour ce territoire', level: 'unknown' }]);
});

test('no em-dash, no name', async () => {
  for (const [n, d, p] of [['nancy', '54', NANCY], ['saint-veran', '05', SAINT_VERAN], ['fort-de-france', '972', FORT_DE_FRANCE]])
    assert.doesNotMatch(visible(commercesView(await file(n, d), p)), /—/);
});

test('the nearest shop on foot wins over the nearest as the crow flies', async () => {
  const f = await file('nancy', '54');
  const near = candidates(f, NANCY);
  assert.ok(near.every((xs) => xs.length <= 2));
  near[0] = [{ ...near[0][0], walk: { m: 800, min: 12, line: [] } }, { ...near[0][1], walk: { m: 300, min: 5, line: [] } }];
  const v = commercesView(f, NANCY, near);
  assert.equal(v.facts[0].value, 'Boulangerie à 300 m à pied, 5 min');
  const bakery = v.items.find((i) => i.name === 'Boulangerie');
  assert.deepEqual([bakery.walk.m, bakery.at], [300, near[0][1].at]);
  assert.match(v.explanation, /à pied.*IGN.*3 km.*vol d’oiseau/);
});
