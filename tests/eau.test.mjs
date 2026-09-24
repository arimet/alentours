import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resultsUrl, udiUrl, networks, latestPerNetwork, conformityFact, measureFact, buildView, PARAMS } from '../src/lib/eau.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const all = (commune) => ({
  udi: fixture(`eau-udi-${commune}.json`),
  conformite: fixture(`eau-${commune}-conformite.json`),
  nitrates: fixture(`eau-${commune}-nitrates.json`),
  pfas: fixture(`eau-${commune}-pfas.json`),
  pesticides: fixture(`eau-${commune}-pesticides.json`),
});
const empty = { count: 0, data: [] };

test('URLs are filtered and small', () => {
  const u = new URL(resultsUrl('75056', PARAMS.nitrates, 2026));
  assert.equal(u.pathname, '/api/v1/qualite_eau_potable/resultats_dis');
  assert.equal(u.searchParams.get('code_commune'), '75056');
  assert.equal(u.searchParams.get('code_parametre'), '1340');
  assert.equal(u.searchParams.get('date_min_prelevement'), '2025-01-01');
  assert.equal(u.searchParams.get('size'), '20');
  assert.ok(u.searchParams.get('fields').includes('resultat_alphanumerique'));
  const v = new URL(udiUrl('05157', 2026));
  assert.equal(v.searchParams.get('annee'), '2026,2025');
});

test('networks keep only the latest year', () => {
  assert.deepEqual(networks(fixture('eau-udi-saint-veran.json')), [{ code: '005001137', name: 'ST VERAN ENSEMBLE', quartier: undefined }]);
  const paris = networks(fixture('eau-udi-paris.json'));
  assert.equal(paris.length, 4);
  assert.equal(paris[0].quartier, 'du 1° au 13°, 15° et 16° arrondissement');
  assert.deepEqual(networks(empty), []);
});

test('groups rows by sample and keeps the latest sample of each network', () => {
  const rows = [
    { code_prelevement: 'A', date_prelevement: '2026-04-30T10:00:00Z', reseaux: [{ code: '1', nom: 'EST' }] },
    { code_prelevement: 'A', date_prelevement: '2026-04-30T10:00:00Z', reseaux: [{ code: '1', nom: 'EST' }] },
    { code_prelevement: 'B', date_prelevement: '2026-04-01T10:00:00Z', reseaux: [{ code: '1', nom: 'EST' }] },
    { code_prelevement: 'C', date_prelevement: '2026-03-01T10:00:00Z', reseaux: [{ code: '2', nom: 'CENTRE' }] },
  ];
  const samples = latestPerNetwork(rows);
  assert.deepEqual(samples.map((s) => s.code), ['A', 'C']);
  assert.equal(samples[0].rows.length, 2);
  assert.equal(samples[1].network, 'CENTRE');
});

test('a conform commune is ok, with the sample date', () => {
  const f = conformityFact(fixture('eau-saint-veran-conformite.json').data);
  assert.equal(f.level, 'ok');
  assert.equal(f.value, 'Conforme');
  assert.match(f.detail, /19 juin 2026/);
});

test('a bacteriological non-conformity on one network is the worst case', () => {
  const f = conformityFact(fixture('eau-arvieux-conformite.json').data);
  assert.equal(f.level, 'alert');
  assert.equal(f.value, 'Non conforme');
  assert.match(f.detail, /bactériolog/);
  assert.match(f.detail, /CHEF LIEU/);
  assert.match(f.detail, /31 juillet 2026/);
});

test('a physico-chemical non-conformity is a warning', () => {
  const row = { code_prelevement: 'X', date_prelevement: '2026-05-01T08:00:00Z', reseaux: [], conformite_limites_bact_prelevement: 'C', conformite_limites_pc_prelevement: 'N' };
  const f = conformityFact([row]);
  assert.equal(f.level, 'warn');
  assert.match(f.detail, /physico-chimique/);
});

test('below the detection limit shows the text, never 0', () => {
  const f = measureFact('PFAS', fixture('eau-saint-veran-pfas.json').data);
  assert.equal(f.value, '<0,029 µg/L');
  assert.equal(f.level, 'ok');
  assert.match(f.detail, /0,1 µg\/L/);
});

test('nitrates: worst network value against the limit from the API', () => {
  const f = measureFact('Nitrates', fixture('eau-paris-nitrates.json').data);
  assert.equal(f.level, 'ok');
  assert.match(f.value, /mg\/L$/);
  assert.match(f.detail, /50 mg\/L/);
  const worst = Math.max(...latestPerNetwork(fixture('eau-paris-nitrates.json').data).map((s) => s.rows[0].resultat_numerique));
  assert.equal(f.value, `${worst.toFixed(2).replace('.', ',')} mg/L`);
});

test('a value above the limit is a warning', () => {
  const row = { code_prelevement: 'X', date_prelevement: '2026-05-01T08:00:00Z', reseaux: [], resultat_alphanumerique: '0,25', resultat_numerique: 0.25, libelle_unite: 'µg/L', limite_qualite_parametre: '<=0,1 µg/L' };
  assert.equal(measureFact('PFAS', [row]).level, 'warn');
});

test('no measure gives unknown with an explanation', () => {
  const f = measureFact('PFAS', []);
  assert.equal(f.level, 'unknown');
  assert.ok(f.detail);
  assert.equal(conformityFact([]).level, 'unknown');
});

test('Paris: several networks are said out loud', () => {
  const v = buildView(all('paris'));
  assert.equal(v.facts.length, 3);
  assert.ok(v.notes.some((n) => /4 réseaux/.test(n)));
  assert.equal(v.precision, 'réseau d’eau de la commune, pas l’adresse exacte');
  assert.equal(v.source.updated, '30 avril 2026');
  assert.ok(v.items.some((i) => /pesticides/i.test(i.name)));
});

test('Saint-Véran: one network, no multi-network note', () => {
  const v = buildView(all('saint-veran'));
  assert.ok(!v.notes.some((n) => /réseaux/.test(n)));
  assert.equal(v.facts[2].value, '<0,029 µg/L');
});

test('partial failure shows what is available with a note', () => {
  const v = buildView({ ...all('saint-veran'), pfas: null });
  assert.equal(v.facts[2].level, 'unknown');
  assert.ok(v.notes.some((n) => /indisponible/.test(n)));
});

test('an empty commune gives unknown levels', () => {
  const v = buildView({ udi: empty, conformite: empty, nitrates: empty, pfas: empty, pesticides: empty });
  assert.ok(v.facts.every((f) => f.level === 'unknown'));
  assert.equal(v.source.updated, undefined);
});

test('no visible string has an em-dash', () => {
  for (const c of ['paris', 'saint-veran', 'arvieux']) assert.ok(!JSON.stringify(buildView(all(c))).includes('—'));
});

test('without flags, the ARS conclusion text decides', () => {
  const row = { code_prelevement: 'X', date_prelevement: '2026-05-01T08:00:00Z', reseaux: [], conclusion_conformite_prelevement: "Eau d'alimentation non-conforme aux exigences de qualité." };
  const f = conformityFact([row]);
  assert.equal(f.level, 'warn');
  assert.match(f.detail, /non-conforme/);
});

test('a result sent as "<SEUIL" says it is below the lab threshold, not "<SEUIL µg/L"', () => {
  const row = { code_prelevement: 'x', date_prelevement: '2026-03-11T08:40:00Z', resultat_alphanumerique: '<SEUIL', resultat_numerique: 0, libelle_unite: 'µg/L', limite_qualite_parametre: '<=0,1 µg/L', reseaux: [{ code: 'r', nom: 'R' }] };
  assert.equal(measureFact('PFAS', [row]).value, 'Sous le seuil de détection du laboratoire');
});
