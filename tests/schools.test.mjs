import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { nearestUrl, parseSchools, schoolsView, schoolName, catchmentUrl, matchCatchment, normStreet } from '../src/lib/schools.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const PLACES = {
  nancy: { housenumber: '35', street: 'Rue Joseph Mougin' },
  'saint-veran': {},
  segur: { housenumber: '20', street: 'Avenue de Ségur' },
};
// Same flow as src/blocks/schools.ts, on the answers captured for each place.
const lists = (place) => {
  const f = (n) => fixture(`schools-${place}-${n}.json`);
  const ids = matchCatchment(f('catchment-map'), PLACES[place]);
  const catchment = ids.length && existsSync(new URL(`fixtures/schools-${place}-catchment.json`, import.meta.url)) ? parseSchools('middle', f('catchment')) : [];
  return { primary: parseSchools('primary', f('primary')), middle: parseSchools('middle', f('middle')), high: parseSchools('high', f('high')), catchment };
};

test('queries nearest-first around the point; collèges and lycées public only', () => {
  const u = new URL(nearestUrl('middle', { lat: 48.850699, lon: 2.308628 }, 2));
  const where = u.searchParams.get('where');
  assert.match(where, /within_distance\(position, geom'POINT\(2\.308628 48\.850699\)', 60km\)/);
  assert.match(where, /libelle_nature LIKE 'COLLEGE%'/);
  assert.match(where, /statut_public_prive='Public'/);
  assert.doesNotMatch(new URL(nearestUrl('primary', { lat: 0, lon: 0 }, 2)).searchParams.get('where'), /Public/);
  assert.equal(u.searchParams.get('order_by'), 'dist');
});

test('catchment map: queried by district code, street matched on its last word', () => {
  const where = new URL(catchmentUrl('75107', 'Avenue de Ségur')).searchParams.get('where');
  assert.equal(where, "code_insee='75107' AND (secteur_unique='O' OR type_et_libelle LIKE '%SEGUR%')");
  assert.equal(new URL(catchmentUrl('05157')).searchParams.get('where'), "code_insee='05157' AND (secteur_unique='O')");
});

test('normalises street names like the catchment map', () => {
  assert.equal(normStreet('Avenue du Mal de Lattre de Tassigny'), 'AVENUE DU MARECHAL DE LATTRE DE TASSIGNY');
  assert.equal(normStreet('AVENUE DU MAL DE LATTRE DE TASSIGNY'), 'AVENUE DU MARECHAL DE LATTRE DE TASSIGNY');
  assert.equal(normStreet('Place Saint-Thomas d’Aquin'), 'PLACE SAINT THOMAS D AQUIN');
  assert.equal(normStreet('Rue St Jean'), 'RUE SAINT JEAN');
});

test('matches the number within the range, with parity', () => {
  const map = fixture('schools-nancy-catchment-map.json');
  // 35 rue Joseph Mougin: two contradictory rows (35-39 odd) in the dataset, as for most of the street.
  assert.deepEqual(matchCatchment(map, PLACES.nancy).sort(), ['0541327Z', '0541469D']);
  // 33 falls between the odd ranges 29-31 and 35-39.
  assert.deepEqual(matchCatchment(map, { housenumber: '33', street: 'Rue Joseph Mougin' }), []);
  assert.deepEqual(matchCatchment(map, { housenumber: '5', street: 'Rue Inconnue' }), []);
  // Without a number the street has two collèges: cannot tell.
  assert.deepEqual(matchCatchment(map, { street: 'Rue Joseph Mougin' }), []);
  assert.deepEqual(matchCatchment(fixture('schools-segur-catchment-map.json'), PLACES.segur), ['0752249M']);
  assert.deepEqual(matchCatchment(fixture('schools-segur-catchment-map.json'), { housenumber: '21', street: 'Avenue de Ségur' }), ['0752249M']);
  assert.deepEqual(matchCatchment(fixture('schools-segur-catchment-map.json'), { housenumber: '57', street: 'Avenue de Ségur' }), ['0752528R']);
});

test('Nancy, 35 rue Joseph Mougin: public schools first, both collèges shown honestly', () => {
  const v = schoolsView(lists('nancy'));
  assert.ok(v.facts.length <= 4);
  assert.deepEqual(v.facts.map((f) => [f.label, f.value]), [
    ['Maternelle publique la plus proche', 'à 450 m à vol d’oiseau'],
    ['Élémentaire publique la plus proche', 'à 330 m à vol d’oiseau'],
    ['Collège de secteur', '2 collèges possibles'],
    ['Lycée public le plus proche', 'à 1,8 km à vol d’oiseau'],
  ]);
  assert.match(v.facts[0].detail, /Michelet/);
  assert.equal(v.facts[2].detail, 'La carte scolaire indique deux collèges pour cette adresse : Collège Jean Lamour (Nancy) à 100 m à vol d’oiseau ou Collège Jean de La Fontaine (Laxou) à 2,1 km à vol d’oiseau. Vérifiez auprès du conseil départemental.');
  const names = v.items.map((i) => i.name);
  assert.ok(names.includes('Ecole élémentaire d\'application Boudonville'));
  // The private school nearest to the address comes after every public one.
  const providence = names.indexOf('Ecole primaire privée La Providence');
  assert.ok(providence > names.indexOf('Ecole maternelle Buffon'));
  assert.match(v.items[providence].detail, /privé sous contrat/);
  assert.ok(v.items.some((i) => /hors contrat/.test(i.detail)));
  assert.ok(v.items.some((i) => /professionnel/.test(i.detail)));
  assert.match(v.explanation, /Le secteur de l’école est fixé par la mairie : renseignez-vous auprès d’elle\./);
  assert.match(v.explanation, /Affelnet/);
  assert.doesNotMatch(JSON.stringify(v), /—/);
  assert.match(v.notes[0].text, /02\/02\/2026/);
});

test('Saint-Véran: single-sector commune, far collège and lycée', () => {
  const v = schoolsView(lists('saint-veran'));
  assert.deepEqual(v.facts.map((f) => f.value), ['à 3,3 km à vol d’oiseau', 'à 700 m à vol d’oiseau', 'Collège des Hautes Vallées', 'à 28 km à vol d’oiseau']);
  assert.match(v.facts[0].detail, /MOLINES/); // a primaire counts as a preschool
  assert.match(v.facts[2].detail, /17 km.*carte scolaire/);
  assert.match(v.facts[3].detail, /général, technologique et professionnel/);
  assert.equal(v.items.filter((i) => i.detail.startsWith('public')).length >= 5, true);
  assert.equal(v.source.updated, '24/09/2026');
});

test('Paris, 20 avenue de Ségur: the catchment collège is not the nearest one', () => {
  const l = lists('segur');
  assert.equal(l.middle[0].name, 'Collège Victor Duruy');
  const v = schoolsView(l);
  assert.deepEqual([v.facts[2].label, v.facts[2].value], ['Collège de secteur', 'Collège Jules Romains']);
  assert.equal(v.items[0].name, 'École élémentaire DUQUESNE 42 avenue duquesne');
  assert.ok(v.items.length <= 10 + 4 + 1 + 2);
});

test('falls back to the nearest public collège when the address is not in the catchment map', () => {
  const l = { ...lists('nancy'), catchment: [] };
  const f = schoolsView(l).facts[2];
  assert.equal(f.label, 'Collège public le plus proche (secteur non trouvé)');
  assert.match(f.detail, /Jean Lamour.*pas été trouvée dans la carte scolaire/);
});

test('says so when nothing is within reach', () => {
  const v = schoolsView({ primary: [], middle: [], high: [], catchment: [] });
  assert.equal(v.facts[2].value, 'Aucun collège public à moins de 60 km');
  assert.equal(v.items.length, 0);
});

test('expands the directory abbreviations of primary schools', () => {
  assert.equal(schoolName('E.P.PR JEAN PAUL II 6 rue Albert de Lapparent'), 'École primaire JEAN PAUL II 6 rue Albert de Lapparent');
  assert.equal(schoolName('E.M.PU EBLE'), 'École maternelle EBLE');
  assert.equal(schoolName('Collège Victor Duruy'), 'Collège Victor Duruy');
});

test('the nearest on foot wins: Moselly is 330 m as the crow flies but 842 m on foot', () => {
  const l = lists('nancy');
  const walks = { 'Ecole élémentaire Moselly': { m: 842, min: 13, line: [] }, "Ecole élémentaire d'application Boudonville": { m: 700, min: 11, line: [] } };
  const v = schoolsView({ ...l, primary: l.primary.map((s) => (walks[s.name] ? { ...s, walk: walks[s.name] } : s)) });
  assert.equal(v.facts[1].value, 'à 700 m à pied, 11 min');
  assert.match(v.facts[1].detail, /Boudonville/);
  const i = v.items.findIndex((x) => /Boudonville/.test(x.name));
  assert.equal(v.items[i].walk.m, 700);
  assert.ok(i < v.items.findIndex((x) => /Moselly/.test(x.name)));
  assert.match(v.explanation, /à pied.*IGN.*3 km.*vol d’oiseau/);
  assert.ok(v.notes.includes('Distances à pied : calcul d’itinéraire de la Géoplateforme (IGN).'));
});
