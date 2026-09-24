import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRetry } from '../scripts/retry.mjs';

const answers = (...xs) => { let i = 0; return async () => { const x = xs[i++]; if (x instanceof Error) throw x; return { status: x }; }; };
const quiet = { waitMs: 0, log: () => {} };

test('retries dropped connections and 5xx, then succeeds', async () => {
  const res = await fetchRetry('u', { ...quiet, fetchFn: answers(new Error('other side closed'), 503, 200) });
  assert.equal(res.status, 200);
});

test('does not retry a 404, and gives up after the last try', async () => {
  assert.equal((await fetchRetry('u', { ...quiet, fetchFn: answers(404, 200) })).status, 404);
  await assert.rejects(fetchRetry('u', { ...quiet, tries: 2, fetchFn: answers(new Error('a'), new Error('b')) }), /b/);
  assert.equal((await fetchRetry('u', { ...quiet, tries: 2, fetchFn: answers(502, 502) })).status, 502);
});
