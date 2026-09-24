import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWalk, formatWalk, byWalk, walkUrl, walkTo, resetWalks, MAX_WALK_M } from '../src/lib/walk.ts';

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

test('a 429 waits and tries again; other errors give up at once', async () => {
  const fixtureAnswer = fixture;
  let calls = 0;
  const get = async () => { calls++; if (calls === 1) throw new Error('HTTP 429'); return fixtureAnswer; };
  const waits = [];
  const w = await walkTo(home, { lat: 48.7, lon: 6.15 }, { get, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(w.m, 842);
  assert.deepEqual(waits, [5000]);
  calls = 0;
  const failing = async () => { calls++; throw new Error('HTTP 500'); };
  assert.equal(await walkTo(home, { lat: 48.7, lon: 6.15 }, { get: failing, sleep: async () => {} }), null);
  assert.equal(calls, 1);
});

test('opening another address drops the routes still queued', async () => {
  let calls = 0;
  const get = async () => { calls++; return fixture; };
  const pending = [walkTo(home, home, { get }), walkTo(home, home, { get }), walkTo(home, home, { get })];
  resetWalks();
  const out = await Promise.all(pending);
  assert.ok(out.filter((x) => x === null).length >= 2, JSON.stringify(out.map(Boolean)));
  assert.ok(calls <= 1);
});

test('the default theme is routed first, even when asked last', async () => {
  const seen = [];
  const get = (tag) => async () => { seen.push(tag); return fixture; };
  await Promise.all([
    walkTo(home, home, { get: get('shop-1') }),
    walkTo(home, home, { get: get('shop-2') }),
    walkTo(home, home, { get: get('school'), priority: 0 }),
  ]);
  // The first job may already be served when the others arrive; the school jumps the rest.
  assert.ok(seen.indexOf('school') <= 1, seen.join(','));
});
