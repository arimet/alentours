import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { nearestUrl, parseSchools, schoolsView, schoolName, carteUrl, matchSecteur, normStreet } from '../src/lib/ecoles.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const PLACES = {
  nancy: { housenumber: '35', street: 'Rue Joseph Mougin' },
  'saint-veran': {},
  segur: { housenumber: '20', street: 'Avenue de Ségur' },
};
// Same flow as src/blocks/ecoles.ts, on the answers captured for each place.
const lists = (place) => {
  const f = (n) => fixture(`ecoles-${place}-${n}.json`);
  const ids = matchSecteur(f('carte'), PLACES[place]);
  const secteur = ids.length && existsSync(new URL(`fixtures/ecoles-${place}-secteur.json`, import.meta.url)) ? parseSchools('college', f('secteur')) : [];
  return { ecole: parseSchools('ecole', f('ecole')), college: parseSchools('college', f('college')), lycee: parseSchools('lycee', f('lycee')), secteur };
};

test('queries nearest-first around the point; collèges and lycées public only', () => {
  const u = new URL(nearestUrl('college', { lat: 48.850699, lon: 2.308628 }, 2));
  const where = u.searchParams.get('where');
  assert.match(where, /within_distance\(position, geom'POINT\(2\.308628 48\.850699\)', 60km\)/);
  assert.match(where, /libelle_nature LIKE 'COLLEGE%'/);
  assert.match(where, /statut_public_prive='Public'/);
  assert.doesNotMatch(new URL(nearestUrl('ecole', { lat: 0, lon: 0 }, 2)).searchParams.get('where'), /Public/);
  assert.equal(u.searchParams.get('order_by'), 'dist');
});

test('carte scolaire: queried by district code, street matched on its last word', () => {
  const where = new URL(carteUrl('75107', 'Avenue de Ségur')).searchParams.get('where');
  assert.equal(where, "code_insee='75107' AND (secteur_unique='O' OR type_et_libelle LIKE '%SEGUR%')");
  assert.equal(new URL(carteUrl('05157')).searchParams.get('where'), "code_insee='05157' AND (secteur_unique='O')");
});

test('normalises street names like the carte scolaire', () => {
  assert.equal(normStreet('Avenue du Mal de Lattre de Tassigny'), 'AVENUE DU MARECHAL DE LATTRE DE TASSIGNY');
  assert.equal(normStreet('AVENUE DU MAL DE LATTRE DE TASSIGNY'), 'AVENUE DU MARECHAL DE LATTRE DE TASSIGNY');
  assert.equal(normStreet('Place Saint-Thomas d’Aquin'), 'PLACE SAINT THOMAS D AQUIN');
  assert.equal(normStreet('Rue St Jean'), 'RUE SAINT JEAN');
});

test('matches the number within the range, with parity', () => {
  const carte = fixture('ecoles-nancy-carte.json');
  // 35 rue Joseph Mougin: two contradictory rows (35-39 odd) in the dataset, as for most of the street.
  assert.deepEqual(matchSecteur(carte, PLACES.nancy).sort(), ['0541327Z', '0541469D']);
  // 33 falls between the odd ranges 29-31 and 35-39.
  assert.deepEqual(matchSecteur(carte, { housenumber: '33', street: 'Rue Joseph Mougin' }), []);
  assert.deepEqual(matchSecteur(carte, { housenumber: '5', street: 'Rue Inconnue' }), []);
  // Without a number the street has two collèges: cannot tell.
  assert.deepEqual(matchSecteur(carte, { street: 'Rue Joseph Mougin' }), []);
  assert.deepEqual(matchSecteur(fixture('ecoles-segur-carte.json'), PLACES.segur), ['0752249M']);
  assert.deepEqual(matchSecteur(fixture('ecoles-segur-carte.json'), { housenumber: '21', street: 'Avenue de Ségur' }), ['0752249M']);
  assert.deepEqual(matchSecteur(fixture('ecoles-segur-carte.json'), { housenumber: '57', street: 'Avenue de Ségur' }), ['0752528R']);
});

test('Nancy, 35 rue Joseph Mougin: public schools first, both collèges shown honestly', () => {
  const v = schoolsView(lists('nancy'));
  assert.ok(v.facts.length <= 4);
  assert.deepEqual(v.facts.map((f) => [f.label, f.value]), [
    ['Maternelle publique la plus proche', 'à 450 m'],
    ['Élémentaire publique la plus proche', 'à 330 m'],
    ['Collège de secteur', '2 collèges possibles'],
    ['Lycée public le plus proche', 'à 1,8 km'],
  ]);
  assert.match(v.facts[0].detail, /Michelet/);
  assert.equal(v.facts[2].detail, 'La carte scolaire indique deux collèges pour cette adresse : Collège Jean Lamour (Nancy) à 100 m ou Collège Jean de La Fontaine (Laxou) à 2,1 km. Vérifiez auprès du conseil départemental.');
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
  assert.deepEqual(v.facts.map((f) => f.value), ['à 3,3 km', 'à 700 m', 'Collège des Hautes Vallées', 'à 28 km']);
  assert.match(v.facts[0].detail, /MOLINES/); // a primaire counts as a maternelle
  assert.match(v.facts[2].detail, /17 km.*carte scolaire/);
  assert.match(v.facts[3].detail, /général, technologique et professionnel/);
  assert.equal(v.items.filter((i) => i.detail.startsWith('public')).length >= 5, true);
  assert.equal(v.source.updated, '24/09/2026');
});

test('Paris, 20 avenue de Ségur: the collège de secteur is not the nearest one', () => {
  const l = lists('segur');
  assert.equal(l.college[0].name, 'Collège Victor Duruy');
  const v = schoolsView(l);
  assert.deepEqual([v.facts[2].label, v.facts[2].value], ['Collège de secteur', 'Collège Jules Romains']);
  assert.equal(v.items[0].name, 'École élémentaire DUQUESNE 42 avenue duquesne');
  assert.ok(v.items.length <= 10 + 4 + 1 + 2);
});

test('falls back to the nearest public collège when the address is not in the carte', () => {
  const l = { ...lists('nancy'), secteur: [] };
  const f = schoolsView(l).facts[2];
  assert.equal(f.label, 'Collège public le plus proche (secteur non trouvé)');
  assert.match(f.detail, /Jean Lamour.*pas été trouvée dans la carte scolaire/);
});

test('says so when nothing is within reach', () => {
  const v = schoolsView({ ecole: [], college: [], lycee: [], secteur: [] });
  assert.equal(v.facts[2].value, 'Aucun collège public à moins de 60 km');
  assert.equal(v.items.length, 0);
});

test('expands the directory abbreviations of primary schools', () => {
  assert.equal(schoolName('E.P.PR JEAN PAUL II 6 rue Albert de Lapparent'), 'École primaire JEAN PAUL II 6 rue Albert de Lapparent');
  assert.equal(schoolName('E.M.PU EBLE'), 'École maternelle EBLE');
  assert.equal(schoolName('Collège Victor Duruy'), 'Collège Victor Duruy');
});
