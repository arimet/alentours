import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lambert93, project, encodeTile, parseHeader, cellRange, decodeCell, readPoint, mobileView, DATA_OFFSET } from '../src/lib/mobile.ts';

const near = (got, want, tol = 0.5) => got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < tol, `${got} vs ${want}`));

test('projections match GDAL (gdaltransform from EPSG:4326)', () => {
  near(lambert93(48.8566, 2.3522), [652469.02, 6862035.26]); // Paris
  near(project(2154, 42.70, 9.45), [1228546.05, 6199420.64]); // Bastia, far from the central meridian
  near(project(5490, 16.2411, -61.5334), [656738.83, 1796165.95]); // Pointe-à-Pitre
  near(project(2975, -20.8789, 55.4504), [338807.61, 7690477.75]); // Saint-Denis de La Réunion
  near(project(4471, -12.7806, 45.2279), [524735.37, 8587115.81]); // Mamoudzou
  near(project(2972, 4.9372, -52.326), [352980.20, 545868.92]); // Cayenne
});

// 3 × 2 grid of 200 m cells, 5 layers so a cell spans 2 bytes.
const header = {
  epsg: 2154, x0: 652000, y0: 6862400, cell: 200, width: 3, height: 2,
  layers: ['Orange', 'SFR', 'Bouygues Telecom', 'Free Mobile', 'Orange'].map((operator, i) => ({ operator, techno: i < 4 ? '4G' : '5G', date: i < 4 ? '2026-03-31' : '2025-12-31' })),
};
const grids = [0, 1, 2, 3, 1].map((v, layer) => Uint8Array.from({ length: 6 }, (_, c) => (v + c + layer) % 4));
const tile = encodeTile(header, grids);

test('synthetic tile: header round trip and cell bytes', () => {
  assert.equal(tile.length, DATA_OFFSET + 6 * 2);
  assert.deepEqual(parseHeader(tile), header);
  // Paris point: x 652469 → column 2, y 6862035 → row 1 (the second row, going south).
  const r = cellRange(header, 48.8566, 2.3522);
  assert.deepEqual(r, { start: DATA_OFFSET + (1 * 3 + 2) * 2, end: DATA_OFFSET + 12 });
  assert.deepEqual(decodeCell(header, tile.subarray(r.start, r.end)), grids.map((g) => g[5]));
  assert.equal(readPoint(tile, 48.9, 2.3522), undefined); // north of the grid
});

test('view: one fact per operator, level words, icon on 4G, both dates', () => {
  const v = mobileView(header, [3, 2, 1, 0, 0]);
  assert.deepEqual(v.facts.map((f) => [f.label, f.value, f.level]), [
    ['Orange', '4G : très bonne couverture, 5G : pas de couverture', 'ok'],
    ['SFR', '4G : bonne couverture', 'ok'],
    ['Bouygues Telecom', '4G : couverture limitée', 'warn'],
    ['Free Mobile', '4G : pas de couverture', 'alert'],
  ]);
  assert.equal(v.precision, 'carreau de 200 m autour de l’adresse');
  assert.equal(v.source.updated, '31/03/2026 (4G) et du 31/12/2025 (5G)');
  assert.match(v.notes[0], /^Ces cartes sont des simulations fournies par les opérateurs, pas des mesures\. Précision d’environ 100 m/);
  assert.doesNotMatch(JSON.stringify(v), /—/);
});

test('view: 5G published without levels reads as available or not', () => {
  const h = { ...header, layers: [{ operator: 'Orange', techno: '4G', date: '2026-03-31' }, { operator: 'Orange', techno: '5G', date: '2025-12-31', graded: false }] };
  assert.equal(mobileView(h, [2, 1]).facts[0].value, '4G : bonne couverture, 5G : disponible');
  assert.equal(mobileView(h, [2, 0]).facts[0].value, '4G : bonne couverture, 5G : pas de couverture');
});

// Real extract of the Guadeloupe tile built by scripts/mobile.mjs (Arcep 2026_T1), cropped
// around Pointe-à-Pitre with scripts/mobile-crop.mjs.
test('real tile: Pointe-à-Pitre is well covered, the sea is not', () => {
  const real = readFileSync(new URL('fixtures/mobile-971-pointe-a-pitre.bin', import.meta.url));
  const h = parseHeader(real);
  assert.equal(h.epsg, 5490);
  assert.deepEqual(h.layers.map((l) => l.operator), ['Orange Caraïbe', 'SFR Caraïbe', 'Free Caraïbe', 'Digicel']);
  assert.deepEqual(readPoint(real, 16.2411, -61.5334), [3, 3, 3, 3]); // Place de la Victoire
  assert.deepEqual(readPoint(real, 16.17, -61.50), [0, 0, 0, 0]); // open sea, 8 km south of the town
});
