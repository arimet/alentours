import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixText, family, layerUrl, props, urbanismView } from '../src/lib/urbanism.ts';

// Real API Carto answers of 24/09/2026, geometries stripped.
const layers = (place) => Object.fromEntries(Object.entries(JSON.parse(readFileSync(new URL(`fixtures/urbanism-${place}.json`, import.meta.url))))
  .map(([k, v]) => [k, props(v)]));
const facts = (v) => v.facts.map((f) => [f.label, f.value]);

test('queries the point, cadastre on its own path', () => {
  const u = new URL(layerUrl('zone-urba', { lat: 48.850699, lon: 2.308628 }));
  assert.equal(u.pathname, '/api/gpu/zone-urba');
  assert.deepEqual(JSON.parse(u.searchParams.get('geom')), { type: 'Point', coordinates: [2.308628, 48.850699] });
  assert.equal(new URL(layerUrl('cadastre', { lat: 0, lon: 0 })).pathname, '/api/cadastre/parcelle');
});

test('repairs UTF-8 read as Latin-1, leaves clean text alone', () => {
  assert.equal(fixText('HÃ´tel de Bourbon CondÃ© (ancien)'), 'Hôtel de Bourbon Condé (ancien)');
  assert.equal(fixText('\u00c3\u0089glise Saint-FranÃ§ois-Xavier'), 'Église Saint-François-Xavier');
  assert.equal(fixText('Ensemble urbain à Paris'), 'Ensemble urbain à Paris');
  assert.equal(fixText('Maisons de Jean Prouvé'), 'Maisons de Jean Prouvé');
});

test('zone families from the code de l’urbanisme', () => {
  assert.match(family('U'), /^Zone urbaine/);
  assert.match(family('AUs'), /plus tard/);
  assert.match(family('AUc'), /^Zone à urbaniser :/);
  assert.match(family('Nh'), /^Zone naturelle/);
  assert.equal(family(undefined), undefined);
});

test('Nancy, 35 rue Joseph Mougin: generic U zone of the PLUi, prescriptions listed', () => {
  const v = urbanismView(layers('nancy'));
  assert.deepEqual(facts(v), [
    ['Zone du PLUi', 'U : Zone urbaine'],
    ['Document d’urbanisme', 'Plan local d’urbanisme intercommunal (PLUi)'],
    ['Servitudes d’utilité publique', 'Abords de monument historique'],
    ['Parcelle cadastrale', 'Section AE, n° 404'],
  ]);
  assert.ok(v.facts.every((f) => f.level === 'info'));
  assert.equal(v.facts[1].detail, 'Approuvé le 06/11/2025, dernière procédure le 09/07/2026.');
  assert.equal(v.facts[2].detail, 'Maisons de Jean Prouvé, Croix de chemin.');
  assert.match(v.facts[3].detail, /54395000AE0404, 5 124 m²/);
  assert.equal(v.items[0].url, 'https://www.geoportail-urbanisme.gouv.fr/document/by-id/4bafe85e873958d9ddad93f941bb817e');
  assert.equal(v.items.length, 14);
  assert.ok(v.items.some((i) => i.name === 'Hauteurs : 9 m hauteur de façade + gabarit n°1'));
  assert.equal(v.precision, 'parcelle');
  assert.equal(v.source.updated, 'document du 09/07/2026');
  assert.ok(v.notes.includes('Ces informations ne valent pas certificat. Pour un projet, demandez un certificat d’urbanisme à la mairie.'));
});

test('Paris, 20 avenue de Ségur: UG zone, mis-encoded monument names repaired', () => {
  const v = urbanismView(layers('segur'));
  assert.deepEqual(facts(v), [
    ['Zone du PLU', 'UG : Zone urbaine générale'],
    ['Document d’urbanisme', 'Plan local d’urbanisme (PLU)'],
    ['Servitudes d’utilité publique', 'Abords de monument historique, site inscrit ou classé'],
    ['Parcelle cadastrale', 'Section BQ, n° 3'],
  ]);
  assert.equal(v.facts[1].detail, 'Approuvé le 16/06/2026.');
  assert.match(v.facts[2].detail, /^Hôtel des Invalides, Ecole Militaire, Ministère de la Marine Marchande, Hôtel Montesquiou-Fezensac et 6 autres\.$/);
});

test('Saint-Véran: Ua zone, monument and site patrimonial remarquable', () => {
  const v = urbanismView(layers('saint-veran'));
  assert.equal(v.facts[0].value, 'Ua : Zone urbaine correspondant aux centres anciens et quartiers historiques');
  assert.match(v.facts[0].detail, /^Zone urbaine/);
  assert.equal(v.facts[2].value, 'Abords de monument historique, site patrimonial remarquable');
  assert.equal(v.facts[3].value, 'Section AB, n° 1163');
});

test('Alleyrat: commune under the règlement national d’urbanisme', () => {
  const v = urbanismView(layers('alleyrat'));
  assert.deepEqual(facts(v).slice(0, 2), [
    ['Règles applicables', 'Règlement national d’urbanisme (pas de document local)'],
    ['Servitudes d’utilité publique', 'Aucune au point'],
  ]);
  assert.equal(v.facts.length, 3);
  assert.equal(v.items.length, 0);
  assert.match(v.explanation, /règlement national/);
});

test('Altier: carte communale sector', () => {
  const v = urbanismView(layers('altier'));
  assert.deepEqual(v.facts[0], { label: 'Secteur de la carte communale', value: 'ZC : zone constructible', level: 'info' });
  assert.equal(v.facts[1].value, 'Carte communale');
});

test('place Stanislas: PSMV zone explained, no parcel on the square, 135 SUP summarised', () => {
  const v = urbanismView(layers('stanislas'));
  assert.match(v.facts[0].detail, /plan de sauvegarde et de mise en valeur/);
  assert.equal(v.facts[2].value, 'Abords de monument historique, site patrimonial remarquable');
  assert.match(v.facts[2].detail, / et \d+ autres\.$/);
  assert.equal(v.facts[3].value, 'Aucune parcelle au point');
});

test('slow prescriptions or failing layers: the rest is shown with a note', () => {
  const l = { ...layers('nancy'), 'prescription-surf': null, cadastre: null };
  const v = urbanismView(l);
  assert.equal(v.facts[0].value, 'U : Zone urbaine');
  assert.deepEqual(v.facts[3], { label: 'Parcelle cadastrale', value: 'Donnée indisponible', level: 'unknown', detail: 'Le Géoportail de l’urbanisme n’a pas répondu à temps.' });
  assert.equal(v.items.length, 1);
  assert.ok(v.notes.some((n) => /prescriptions du plan .* n’ont pas pu être chargées/.test(n)));
});
