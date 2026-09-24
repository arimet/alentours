import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWalk, formatWalk, byWalk, walkUrl, MAX_WALK_M } from '../src/lib/walk.ts';

const fixture = JSON.parse(readFileSync(new URL('fixtures/walk-nancy-moselly.json', import.meta.url)));
const home = { lat: 48.703193, lon: 6.16209 };

test('parses a pedestrian route: 330 m as the crow flies is 842 m on foot', () => {
  const w = parseWalk(fixture);
  assert.equal(w.m, 842);
  assert.equal(w.min, 13);
  assert.ok(w.line.length > 10);
  assert.equal(formatWalk(w), 'à 840 m à pied, 13 min');
  assert.equal(parseWalk({ error: 'x' }), null);
});

test('route URL puts longitude first', () => {
  assert.match(walkUrl(home, { lat: 1, lon: 2 }), /start=6\.16209%2C48\.703193&end=2%2C1/);
});

test('re-sorts by walking distance, keeps the far and the failed by crow-fly distance', async () => {
  const xs = [
    { name: 'a', distance: 300, at: { lat: 0, lon: 0 } },  // 900 m on foot
    { name: 'b', distance: 500, at: { lat: 0, lon: 1 } },  // 550 m on foot
    { name: 'c', distance: 400, at: { lat: 0, lon: 2 } },  // route fails
    { name: 'd', distance: MAX_WALK_M + 1, at: { lat: 0, lon: 3 } }, // too far to walk
  ];
  const calls = [];
  const walk = async (_, to) => { calls.push(to.lon); return { 0: { m: 900, min: 14, line: [] }, 1: { m: 550, min: 9, line: [] } }[to.lon] ?? null; };
  const out = await byWalk(home, xs, { walk });
  assert.deepEqual(out.map((x) => x.name), ['b', 'a', 'c', 'd']);
  assert.deepEqual(calls.sort(), [0, 1, 2]);
  assert.equal(out[0].walk.m, 550);
  assert.equal(out[2].walk, undefined);
});
