import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nearestUrl, parseSchools, schoolsView, schoolName } from '../src/lib/ecoles.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const lists = (place) => Object.fromEntries(['ecole', 'college', 'lycee'].map((l) => [l, parseSchools(l, fixture(`ecoles-${place}-${l}.json`))]));

test('queries nearest-first around the point, without SEGPA or sections', () => {
  const u = new URL(nearestUrl('college', { lat: 48.850699, lon: 2.308628 }, 2));
  const where = u.searchParams.get('where');
  assert.match(where, /within_distance\(position, geom'POINT\(2\.308628 48\.850699\)', 60km\)/);
  assert.match(where, /libelle_nature LIKE 'COLLEGE%'/);
  assert.equal(u.searchParams.get('order_by'), 'dist');
  assert.equal(u.searchParams.get('limit'), '2');
});

test('Ségur: nearest école, collège and lycée with their sector', () => {
  const l = lists('segur');
  assert.deepEqual(l.ecole.map((s) => [s.name, s.sector, Math.round(s.distance)]), [
    ['École primaire JEAN PAUL II 6 rue Albert de Lapparent', 'privé hors contrat', 227],
    ['École élémentaire DUQUESNE 42 avenue duquesne', 'public', 344],
    ['École primaire EBLE 14 rue Eblé', 'public', 367],
  ]);
  assert.equal(l.college[1].sector, 'privé sous contrat');
  assert.equal(l.lycee[0].voies, 'enseignement général');
  // Matches the page indexed by search engines for this UAI.
});

test('Saint-Véran: far collège and lycée are still found', () => {
  const v = schoolsView(lists('saint-veran'));
  assert.deepEqual(v.facts.map((f) => f.value), ['à 700 m', 'à 17 km', 'à 28 km']);
  assert.match(v.facts[2].detail, /Briançon.*public, enseignement général, technologique et professionnel/);
  assert.equal(v.items.length, 7);
  assert.equal(v.source.updated, '24/09/2026');
  assert.match(v.explanation, /à vol d’oiseau/);
  assert.match(v.explanation, /pas forcément/);
});

test('says so when nothing is within reach', () => {
  const v = schoolsView({ ecole: [], college: [], lycee: [] });
  assert.equal(v.facts[1].value, 'Aucun collège à moins de 60 km');
  assert.equal(v.items.length, 0);
});

test('expands the directory abbreviations of primary schools', () => {
  assert.equal(schoolName('E.P.PR JEAN PAUL II 6 rue Albert de Lapparent'), 'École primaire JEAN PAUL II 6 rue Albert de Lapparent');
  assert.equal(schoolName('École élémentaire DUQUESNE 42 avenue duquesne'), 'École élémentaire DUQUESNE 42 avenue duquesne');
  assert.equal(schoolName('E.M.PU EBLE'), 'École maternelle EBLE');
  assert.equal(schoolName('Collège Victor Duruy'), 'Collège Victor Duruy');
});
