import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment, toFragment } from '../src/lib/fragment.ts';

test('parses a lat,lon fragment', () => {
  assert.deepEqual(parseFragment('#48.8507,2.3095'), { lat: 48.8507, lon: 2.3095 });
  assert.deepEqual(parseFragment('#-21.1151,55.5364'), { lat: -21.1151, lon: 55.5364 }); // La Réunion
});

test('rejects empty, malformed or out-of-range fragments', () => {
  for (const f of ['', '#', '#abc', '#48.85', '#48.85,2.30,1', '#91,2', '#48,181', '#48.8,2.3x'])
    assert.equal(parseFragment(f), null, f);
});

test('round-trips with 5 decimals (about 1 m)', () => {
  assert.equal(toFragment({ lat: 48.850712345, lon: 2.309512 }), '#48.85071,2.30951');
  assert.deepEqual(parseFragment(toFragment({ lat: 48.85071, lon: 2.30951 })), { lat: 48.85071, lon: 2.30951 });
});
