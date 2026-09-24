import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { urls, reportUrl, clayFact, floodFact, communeFact, sitesItems } from '../src/lib/risks.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const segur = { lat: 48.850699, lon: 2.308628, label: '20 Avenue de Ségur 75007 Paris', citycode: '75107', commune: '75056', city: 'Paris' };
const malo = { lat: 48.6493, lon: -2.0257, label: 'Saint-Malo', citycode: '35288', commune: '35288', city: 'Saint-Malo' };

test('builds v1 URLs with longitude first and both district and commune codes', () => {
  const u = urls(segur);
  assert.equal(u.rga, 'https://www.georisques.gouv.fr/api/v1/rga?latlon=2.308628%2C48.850699');
  assert.match(u.tri, /tri_zonage\?latlon=2\.308628%2C48\.850699$/);
  assert.match(u.radon, /radon\?code_insee=75107%2C75056$/);
  assert.match(u.seismic, /zonage_sismique\?code_insee=75107%2C75056$/);
  assert.match(u.ssp, /ssp\?latlon=2\.308628%2C48\.850699&rayon=1000/);
  assert.match(u.icpe, /installations_classees\?latlon=2\.308628%2C48\.850699&rayon=1000/);
  assert.match(urls(malo).radon, /code_insee=35288$/);
});

test('links to the public Géorisques report for the address', () => {
  const u = new URL(reportUrl(segur));
  assert.equal(u.pathname, '/mes-risques/connaitre-les-risques-pres-de-chez-moi/rapport2');
  assert.equal(u.searchParams.get('lon'), '2.308628');
  assert.equal(u.searchParams.get('codeInsee'), '75107');
});

test('clay: medium exposure is a warning', () => {
  const f = clayFact(fixture('risks-archive-rga-saint-malo.json'), malo);
  assert.equal(f.value, 'Exposition moyenne');
  assert.equal(f.level, 'warn');
  assert.match(f.detail, /étude de sol/);
});

test('clay: strong is an alert, weak is info', () => {
  assert.equal(clayFact({ codeExposition: '3', exposition: 'Exposition forte' }, malo).level, 'alert');
  assert.equal(clayFact({ codeExposition: '1', exposition: 'Exposition faible' }, malo).level, 'info');
});

test('clay: no result is ok, except in Paris which the map does not cover', () => {
  assert.equal(clayFact(null, malo).level, 'ok');
  assert.equal(clayFact({}, malo).level, 'ok');
  const paris = clayFact(null, segur);
  assert.equal(paris.level, 'unknown');
  assert.match(paris.detail, /Paris/);
});

test('flood: point inside a TRI lists its scenarios', () => {
  const f = floodFact(fixture('risks-archive-schema-tri-zonage.json'));
  assert.equal(f.level, 'warn');
  assert.equal(f.value, 'En zone inondable cartographiée');
  assert.match(f.detail, /La Seine/);
  assert.match(f.detail, /Moyenne probabilité, Faible probabilité/);
});

test('flood: no TRI zone is info, not "no risk"', () => {
  for (const json of [null, { results: 0, data: [], response_code: 404 }]) {
    const f = floodFact(json);
    assert.equal(f.level, 'info');
    assert.match(f.detail, /ne veut pas dire/);
  }
});

test('commune: seismic zone 2 and radon zone 1', () => {
  const f = communeFact(fixture('risks-archive-zonage-sismique-saint-malo.json'), fixture('risks-archive-radon-saint-malo.json'));
  assert.equal(f.value, 'Séisme : zone 2 (faible). Radon : zone 1 (faible).');
  assert.equal(f.level, 'info');
});

test('commune: the highest level wins, radon zone 3 is a warning', () => {
  const seismic = { data: [{ code_zone: '1' }] };
  const radon = { data: [{ classe_potentiel: '3' }] };
  const f = communeFact(seismic, radon);
  assert.equal(f.level, 'warn');
  assert.match(f.value, /zone 1 \(très faible\).*zone 3 \(significatif\)/);
  assert.equal(communeFact({ data: [{ code_zone: '5' }] }, radon).level, 'alert');
});

test('commune: a missing source is said and is never a green light', () => {
  const f = communeFact(undefined, fixture('risks-archive-radon-saint-malo.json'));
  assert.match(f.value, /Séisme : non disponible/);
  assert.equal(f.level, 'unknown'); // low radon alone does not mean "rien à signaler"
  assert.equal(communeFact(undefined, { data: [] }).level, 'unknown');
});

test('error payloads throw', () => {
  const err = fixture('risks-archive-schema-error.json');
  assert.throws(() => floodFact(err), /Paramètres/);
  assert.throws(() => communeFact(err, err), /Paramètres/);
  assert.throws(() => sitesItems(err, undefined, segur), /Paramètres/);
  assert.throws(() => clayFact({ code: 'INTERNAL', message: 'boom', timestamp: 'x' }, malo), /boom/);
});

test('sites: polluted sites and ICPE, sorted by distance, "Non ICPE" dropped', () => {
  const orleans = { lat: 47.8944, lon: 1.9525 };
  const { items, more } = sitesItems(fixture('risks-archive-schema-ssp.json'), fixture('risks-archive-installations-classees-page1.json'), orleans);
  assert.equal(items[0].name, 'ORLEANS METROPOLE - Parc de Loire');
  assert.match(items[0].detail, /Non Seveso/);
  assert.ok(items[0].distance < 50);
  assert.ok(!items.some((i) => /PROMOCASH|GRANUPLAST/.test(i.name)), '"Non ICPE" is not a classified installation');
  assert.ok(items.every((i, k) => k === 0 || i.distance >= items[k - 1].distance));
  assert.equal(items.length + more, 3 + 7, '3 polluted sites + 7 ICPE with coordinates');
});

test('sites: Seveso comes first and is named', () => {
  const icpe = { data: [
    { raisonSociale: 'Proche', longitude: 2.3087, latitude: 48.8507, statutSeveso: 'Non Seveso', regime: 'Enregistrement', codeAIOT: '1' },
    { raisonSociale: 'Loin', longitude: 2.3200, latitude: 48.8550, statutSeveso: 'Seveso seuil haut', regime: 'Autorisation', codeAIOT: '0005502171' },
  ] };
  const { items } = sitesItems(undefined, icpe, segur);
  assert.equal(items[0].name, 'Loin');
  assert.match(items[0].detail, /^Site Seveso seuil haut/);
  assert.equal(items[0].url, 'https://www.georisques.gouv.fr/risques/installations/donnees/details/0005502171');
});

test('sites: polluted site kinds, fiche link and nameless entries', () => {
  const { items } = sitesItems(fixture('risks-archive-schema-ssp.json'), undefined, segur);
  const factory = items.find((i) => i.name === 'Ancienne usine (exemple)');
  assert.match(factory.detail, /Pollution des sols suivie par l’administration/);
  assert.ok(factory.distance < 400);
  assert.equal(items.find((i) => /Dépôt/.test(i.name)).detail, 'Ancien site industriel ou de service (inventaire CASIAS)');
  assert.equal(items.find((i) => i.name === 'Garage (exemple)').url, 'https://fiches-risques.brgm.fr/georisques/casias/SSP-EX-1');
});

test('sites: empty answers give no items', () => {
  assert.deepEqual(sitesItems({ casias: { data: [] } }, { data: [] }, segur), { items: [], more: 0 });
  assert.deepEqual(sitesItems(undefined, undefined, segur), { items: [], more: 0 });
});
