import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taxView, taxUrl } from '../src/lib/tax.ts';

// Real API responses (taxUrl), fetched on 24/09/2026.
const fixture = (code) => JSON.parse(readFileSync(new URL(`fixtures/tax-${code}.json`, import.meta.url)));
const ctx = (citycode, commune = citycode) => ({ citycode, commune, lat: 0, lon: 0, label: '', city: '' });
const NBSP = '\u00a0';
const visible = (v) => [v.explanation, v.precision, ...(v.notes ?? []), ...v.facts.flatMap((f) => [f.label, f.value, f.detail ?? ''])].join('\n');

test('one query per commune, all years, whole-commune code', () => {
  const url = new URL(taxUrl('75056'));
  assert.equal(url.searchParams.get('where'), 'insee_com="75056"');
  assert.equal(url.searchParams.get('order_by'), 'exercice desc');
});

test('Nancy: 2025 global rate, breakdown, evolution, TEOM', () => {
  const v = taxView(fixture('54395'), ctx('54395'));
  assert.equal(v.facts.length, 4);
  assert.equal(v.facts[0].label, 'Taux global 2025 (propriétés bâties)');
  assert.equal(v.facts[0].value, `43,95${NBSP}%`);
  assert.equal(v.facts[0].level, 'info');
  assert.equal(v.facts[1].value, `Commune 33,98${NBSP}%`);
  assert.match(v.facts[1].detail, /Métropole du Grand Nancy : 9,65.%/);
  assert.match(v.facts[1].detail, /GEMAPI/);
  assert.equal(v.facts[2].value, '+5,32 points depuis 2021');
  assert.match(v.facts[2].detail, /38,63.% en 2021/);
  assert.equal(v.facts[3].value, `6,71${NBSP}%`);
  assert.equal(v.source.updated, 'exercice 2025');
  assert.equal(v.precision, 'à la commune');
});

test('Paris 7e: rate of the whole city, no intercommunal share', () => {
  const v = taxView(fixture('75056'), ctx('75107', '75056'));
  assert.equal(v.facts[0].value, `21,21${NBSP}%`);
  assert.match(v.facts[1].detail, /Métropole du Grand Paris : 0.%/);
  assert.equal(v.facts[2].value, '+7,08 points depuis 2021');
  assert.match(v.precision, /ensemble de Paris/);
});

test('Saint-Véran: no TEOM rate published', () => {
  const v = taxView(fixture('05157'), ctx('05157'));
  assert.equal(v.facts[0].value, `59,67${NBSP}%`);
  assert.equal(v.facts[2].value, '+0,18 point depuis 2021');
  assert.equal(v.facts[3].value, 'Aucun taux publié');
});

test('Metz (Moselle): same national tax', () => {
  const v = taxView(fixture('57463'), ctx('57463'));
  assert.equal(v.facts[0].value, `38,4${NBSP}%`);
  assert.equal(v.facts[3].value, `9,25${NBSP}%`);
});

test('explains the rental value and says to ask for the last notice, no em-dash', () => {
  const v = taxView(fixture('54395'), ctx('54395'));
  assert.match(v.explanation, /valeur locative cadastrale/);
  assert.match(v.explanation, /dernier avis/);
  for (const c of ['54395', '75056', '05157', '57463']) assert.doesNotMatch(visible(taxView(fixture(c), ctx(c))), /—/);
});

test('unknown commune: says the data is missing', () => {
  const v = taxView({ total_count: 0, results: [] }, ctx('97502'));
  assert.equal(v.facts.length, 1);
  assert.equal(v.facts[0].level, 'unknown');
});
