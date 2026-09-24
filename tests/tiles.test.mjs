import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileOf, project } from '../src/lib/tiles.ts';

test('Web Mercator tile and pixel offset of a point', () => {
  // 20 avenue de Ségur, zoom 16
  const t = tileOf({ lat: 48.850699, lon: 2.308628 }, 16);
  assert.equal(t.x, 33188);
  assert.equal(t.y, 22547); // checked with the asinh(tan) formula
  assert.ok(t.px >= 0 && t.px < 256 && t.py >= 0 && t.py < 256);
});

test('works south of the equator and west of Greenwich', () => {
  const t = tileOf({ lat: -21.1151, lon: 55.5364 }, 1);
  assert.deepEqual([t.x, t.y], [1, 1]);
  const m = tileOf({ lat: 14.603312, lon: -61.069095 }, 1);
  assert.deepEqual([m.x, m.y], [0, 0]);
});

test('world pixels double with each zoom level', () => {
  const a = project({ lat: 48.85, lon: 2.3 }, 10), b = project({ lat: 48.85, lon: 2.3 }, 11);
  assert.ok(Math.abs(b.x - 2 * a.x) < 1e-6 && Math.abs(b.y - 2 * a.y) < 1e-6);
  assert.deepEqual(project({ lat: 0, lon: 0 }, 0), { x: 128, y: 128 });
});
