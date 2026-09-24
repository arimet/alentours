import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, build } from '../scripts/risks.mjs';
import { communeOf, gasparFacts, risksView } from '../src/lib/risks.ts';

// Extract of public/data/risks/75.json and 05.json (GASPAR 21/09/2026, radon 2019).
const file = JSON.parse(readFileSync(new URL('fixtures/risks-commune-excerpt.json', import.meta.url)));
const segur = { lat: 48.850699, lon: 2.308628, label: '20 Avenue de Ségur 75007 Paris', citycode: '75107', commune: '75056', city: 'Paris' };
const veran = { lat: 44.7, lon: 6.87, label: 'Saint-Véran', citycode: '05157', commune: '05157', city: 'Saint-Véran' };
const down = Array(6).fill(undefined);

test('csv: quoted fields keep their ";", values are trimmed', () => {
  const rows = parseCsv('a;b\r\n"x ; y";z \r\n');
  assert.deepEqual(rows, [{ a: 'x ; y', b: 'z' }]);
});

test('build: main DDRM risks, plans in force, CatNat over 30 years', () => {
  const out = build({
    radon: [{ insee_com: '75107', classe_potentiel: '1' }, { insee_com: '5157', classe_potentiel: '2' }],
    ddrm: [{ cod_commune: '05157', num_risque: '11', lib_risque: 'Inondation' }, { cod_commune: '05157', num_risque: '112', lib_risque: 'Par une crue' }],
    pprn: [
      { 'CODE INSEE COMMUNE': '05157', 'LIBELLE PROCEDURE': 'PPR A', 'LIBELLE ETAT': 'Opposable', 'LIBELLE SOUS-ETAT': 'Approuvé' },
      { 'CODE INSEE COMMUNE': '05157', 'LIBELLE PROCEDURE': 'PPR A', 'LIBELLE ETAT': 'Opposable', 'LIBELLE SOUS-ETAT': 'Approuvé' },
      { 'CODE INSEE COMMUNE': '05157', 'LIBELLE PROCEDURE': 'PPR B', 'LIBELLE ETAT': 'Caduque', 'LIBELLE SOUS-ETAT': 'Abrogé' },
    ],
    pprt: [],
    catnat: [
      { id_gaspar: 'X1', code_commune: '05157', num_risque_jo: 'ICB', lib_risque_jo: 'Inondations et/ou Coulées de Boue', date_debut: '2023-12-01 00:00:00' },
      { id_gaspar: 'X1', code_commune: '05157', num_risque_jo: 'ICB', lib_risque_jo: 'Inondations et/ou Coulées de Boue', date_debut: '2023-12-01 00:00:00' },
      { id_gaspar: 'X0', code_commune: '05157', num_risque_jo: 'SEC', lib_risque_jo: 'Sécheresse', date_debut: '2010-06-01 00:00:00' },
      { id_gaspar: 'OLD', code_commune: '05157', num_risque_jo: 'TMP', lib_risque_jo: 'Tempête', date_debut: '1982-11-06 00:00:00' },
    ],
  }, new Date('2026-09-24'));
  assert.deepEqual(out['75107'], { radon: 1 });
  assert.deepEqual(out['05157'], {
    radon: 2,
    risques: ['Inondation'],
    pprn: [{ nom: 'PPR A', etat: 'Approuvé' }],
    catnat: { n: 2, depuis: '1996-09-24', dernier: '2023-12-01', type: 'Inondations et/ou Coulées de Boue' },
  });
});

test('commune entry: Paris merges the whole city (GASPAR) with the district (radon)', () => {
  const c = communeOf(file, segur);
  assert.equal(c.radon, 1);
  assert.ok(c.risques.includes('Inondation'));
  assert.equal(communeOf(file, { ...segur, commune: '99999', citycode: '99999' }), undefined);
  assert.equal(communeOf(undefined, segur), undefined);
});

test('gaspar facts: DDRM risks with plans, then CatNat', () => {
  const [risksFact, catnat] = gasparFacts(communeOf(file, veran));
  assert.equal(risksFact.value, 'Inondation, Mouvement de terrain, Séisme, Avalanche, Feu de forêt');
  assert.match(risksFact.detail, /Plan de prévention des risques naturels : PPRN-Multi - Saint-Véran 2018 \(approuvé\)/);
  assert.equal(catnat.value, '3 reconnaissances depuis 1996');
  assert.match(catnat.detail, /Inondations et\/ou coulées de boue, à partir du 01\/12\/2023/);
});

test('all live calls fail: commune facts only, said out loud', () => {
  const v = risksView(down, file, veran);
  assert.equal(v.precision, 'à la commune');
  assert.deepEqual(v.notes, ['Géorisques ne répond pas : informations à la commune seulement.']);
  assert.deepEqual(v.facts.map((f) => f.label), ['Séisme et radon (commune)', 'Risques recensés dans la commune', 'Catastrophes naturelles reconnues']);
  assert.match(v.facts[0].value, /Séisme : non disponible\. Radon : zone 2 \(faible\)/);
  // Seismic zone missing, radon low: not a green light.
  assert.equal(v.facts[0].level, 'unknown');
  assert.equal(v.source.updated, '21/09/2026');
});

test('everything fails: the block errors as before', () => {
  assert.throws(() => risksView(down, undefined, veran), /Géorisques ne répond pas/);
  assert.throws(() => risksView(down, { _meta: {} }, veran), /Géorisques ne répond pas/);
});

test('live wins; the commune file fills the missing radon and adds GASPAR', () => {
  const live = [{ value: null }, { value: null }, { value: { data: [{ code_zone: '1' }] } }, undefined, { value: {} }, { value: { data: [] } }];
  const v = risksView(live, file, segur);
  const sr = v.facts.find((f) => f.label === 'Séisme et radon (commune)');
  assert.equal(sr.value, 'Séisme : zone 1 (très faible). Radon : zone 1 (faible).');
  assert.ok(v.facts.some((f) => f.label === 'Risques recensés dans la commune'));
  assert.ok(!v.notes.some((n) => /radon/.test(n)), 'radon came from the file, not missing');
  assert.match(v.precision, /risques recensés/);
  const liveRadon = risksView([...live.slice(0, 3), { value: { data: [{ classe_potentiel: '3' }] } }, ...live.slice(4)], file, segur);
  assert.match(liveRadon.facts.find((f) => f.label === 'Séisme et radon (commune)').value, /Radon : zone 3/);
});

test('live without file: unchanged behaviour, missing calls named', () => {
  const v = risksView([{ value: null }, undefined, undefined, undefined, undefined, undefined], undefined, veran);
  assert.deepEqual(v.facts.map((f) => f.label), ['Argiles (sol qui gonfle et se rétracte)']);
  assert.match(v.notes.at(-1), /inondations, la sismicité, le radon, les sites pollués, les installations classées/);
});
