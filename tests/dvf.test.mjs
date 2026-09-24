import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pricesOfYear, buildDepartment, median, parseLine, MIN_SALES } from '../scripts/dvf.mjs';

// Made-up rows in the geo-dvf format (fictitious communes 05998 and 05999): real sales of a
// small commune could be traced back to people, which the DGFiP terms forbid.
// The method itself was checked once against the official Statistiques DVF of Saint-Véran (identical).
const H = 'id_mutation,date_mutation,code_departement,code_commune,id_parcelle,nature_mutation,code_type_local,type_local,valeur_fonciere,surface_reelle_bati';
const row = (id, date, insee, parcel, nature, type, price, surface) =>
  [id, date, '05', insee, parcel, nature, type, { 1: 'Maison', 2: 'Appartement', 3: 'Dépendance' }[type] ?? '', price, surface].join(',');
const LINES = [
  H,
  row('m1', '2025-01-10', '05999', 'p1', 'Vente', 2, 100000, 50), // 2 000 €/m²
  row('m1', '2025-01-10', '05999', 'p1', 'Vente', 3, 100000, ''), // its outbuilding: not a second dwelling
  row('m2', '2025-02-10', '05999', 'p2', 'Vente', 2, 150000, 50), // 3 000 €/m²…
  row('m2', '2025-02-10', '05999', 'p2', 'Vente', 2, 150000, 50), // …listed twice: counted once
  row('m3', '2025-03-10', '05999', 'p3', "Vente en l'état futur d'achèvement", 1, 300000, 100), // house, 3 000 €/m²
  row('m4', '2025-04-10', '05999', 'p4', 'Vente', 1, 200000, 100), // two dwellings in one sale:
  row('m4', '2025-04-10', '05999', 'p5', 'Vente', 2, 200000, 40), //   dropped
  row('m5', '2025-05-10', '05999', 'p6', 'Échange', 2, 100000, 50), // not a sale: dropped
  row('m6', '2025-06-10', '05999', 'p7', 'Vente', 2, 9000000, 50), // 180 000 €/m²: dropped
  row('m7', '2025-07-10', '05999', 'p8', 'Adjudication', 2, 80000, 20), // 4 000 €/m²
  row('m8', '2025-08-10', '05999', 'p9', 'Vente', 2, 100000, 40), // 2 500 €/m²
  row('m9', '2025-09-10', '05999', 'p10', 'Vente', 2, 140000, 40), // 3 500 €/m²
  row('m10', '2025-12-20', '05998', 'p11', 'Vente', 2, 50000, 50), // other commune, 1 000 €/m²
];
const year = { year: 2025, ...(await pricesOfYear(LINES)) };

test('keeps single-dwelling sales under 100 000 €/m², once each, as the official method does', () => {
  assert.deepEqual([...year.communes.get('05999').appartement].sort((a, b) => a - b), [2000, 2500, 3000, 3500, 4000]);
  assert.deepEqual(year.communes.get('05999').maison, [3000]);
  assert.deepEqual(year.communes.get('05998').appartement, [1000]);
  assert.equal(year.from, '2025-01-10');
  assert.equal(year.to, '2025-12-20');
});

test('yearly series, medians hidden below the minimum sample', () => {
  assert.equal(MIN_SALES, 5);
  const d = buildDepartment([year]);
  assert.deepEqual(d['05999'], { years: [2025], appartement: { median: [3000], n: [5] }, maison: { median: [null], n: [1] } });
  assert.deepEqual(d['05998'].appartement, { median: [null], n: [1] });
});

test('pandas-like median and quoted CSV', () => {
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3); // 2.5 rounded
  assert.equal(median([]), null);
  assert.deepEqual(parseLine('a,"b, c",,"d ""e"""'), ['a', 'b, c', '', 'd "e"']);
});
