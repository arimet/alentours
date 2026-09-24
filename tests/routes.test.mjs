import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simplify } from '../scripts/routes.mjs';

test('Douglas-Peucker keeps the ends and the real corners, drops near-straight points', () => {
  const line = [[0, 0], [1, 0.001], [2, 0], [2, 1], [2.001, 2], [2, 3]];
  assert.deepEqual(simplify(line, 0.01), [[0, 0], [2, 0], [2, 3]]);
  assert.deepEqual(simplify([[0, 0], [1, 1]], 0.01), [[0, 0], [1, 1]]);
});
