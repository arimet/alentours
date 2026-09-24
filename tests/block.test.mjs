import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDistance, distance } from '../src/lib/block.ts';

test('formats distances in French', () => {
  assert.equal(formatDistance(0), 'à moins de 10 m');
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

test('block status: alerts, then warnings, then missing data, and "Rien à signaler" only if every levelled fact is ok', async () => {
  const { summarize } = await import('../src/lib/block.ts');
  const f = (level) => ({ label: 'x', value: 'y', level });
  assert.deepEqual(summarize([f('alert'), f('warn'), f('alert')]), { level: 'alert', text: '2 points d’attention' });
  assert.deepEqual(summarize([f('ok'), f('warn')]), { level: 'warn', text: '1 point de vigilance' });
  assert.deepEqual(summarize([f('ok'), f('ok')]), { level: 'ok', text: 'Rien à signaler' });
  // A fact that could not be loaded never turns into a green light.
  assert.deepEqual(summarize([f('ok'), f('ok'), f('unknown')]), { level: 'unknown', text: 'Données incomplètes' });
  assert.deepEqual(summarize([f('warn'), f('unknown')]), { level: 'warn', text: '1 point de vigilance' });
  assert.equal(summarize([f('ok'), f('info')]), null);
  assert.equal(summarize([{ label: 'x', value: 'y' }]), null);
});
