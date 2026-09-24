import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDistance, distance } from '../src/lib/block.ts';

test('formats distances in French', () => {
  assert.equal(formatDistance(227), 'à 230 m');
  assert.equal(formatDistance(1234), 'à 1,2 km');
  assert.equal(formatDistance(17420), 'à 17 km');
});

test('haversine distance is right to a few metres', () => {
  // Ségur to Place du Capitole, Toulouse: about 588 km
  const d = distance({ lat: 48.850699, lon: 2.308628 }, { lat: 43.603872, lon: 1.444053 });
  assert.ok(Math.abs(d - 587900) < 2000, String(d));
  assert.equal(distance({ lat: 1, lon: 1 }, { lat: 1, lon: 1 }), 0);
});
