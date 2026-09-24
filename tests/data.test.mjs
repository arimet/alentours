import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departmentOf } from '../src/lib/data.ts';

test('department of a commune code', () => {
  assert.equal(departmentOf('75107'), '75');
  assert.equal(departmentOf('05157'), '05');
  assert.equal(departmentOf('2A004'), '2A'); // Corse-du-Sud
  assert.equal(departmentOf('2B033'), '2B');
  assert.equal(departmentOf('97209'), '972'); // Martinique
  assert.equal(departmentOf('97611'), '976'); // Mayotte
});
