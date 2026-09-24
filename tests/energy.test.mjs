import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aggUrl, atAddress, energyView, nearUrl, parseCounts, parseDpes, parseUpdated } from '../src/lib/energy.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/energy-${name}.json`, import.meta.url)));
const CTX = {
  nancy: { housenumber: '35', street: 'Rue Joseph Mougin', city: 'Nancy', citycode: '54395', commune: '54395' },
  segur: { housenumber: '20', street: 'Avenue de Ségur', city: 'Paris', citycode: '75107', commune: '75056' },
  'saint-veran': { city: 'Saint-Véran', citycode: '05157', commune: '05157' },
};
// Same flow as src/blocks/energy.ts, on the answers captured for each place.
const view = (place, near = parseDpes(fixture(`${place}-near`))) => energyView({
  near,
  ...(CTX[place].street ? { street: parseCounts(fixture(`${place}-street`)) } : {}),
  place: parseCounts(fixture(`${place}-commune`)),
  ctx: CTX[place],
  updated: parseUpdated(fixture('meta')),
});

test('queries: longitude first for geo_distance, district code and quoted street for counts', () => {
  const u = new URL(nearUrl({ lat: 48.703193, lon: 6.16209 }));
  assert.equal(u.searchParams.get('geo_distance'), '6.16209,48.703193,50m');
  assert.match(u.searchParams.get('select'), /identifiant_ban/);
  assert.equal(new URL(aggUrl('75107', 'Avenue de Ségur')).searchParams.get('qs'), 'code_insee_ban:"75107" AND nom_rue_ban:"Avenue de Ségur"');
  assert.equal(new URL(aggUrl('54395', 'Rue "X"')).searchParams.get('qs'), 'code_insee_ban:"54395" AND nom_rue_ban:"Rue \\"X\\""');
  assert.equal(new URL(aggUrl('05157')).searchParams.get('qs'), 'code_insee_ban:"05157"');
});

test('matches the address on number and street, never a DPE geocoded to the street only', () => {
  const near = parseDpes(fixture('nancy-near'));
  assert.deepEqual(atAddress(near, CTX.nancy).map((d) => [d.type, d.date]), [['immeuble', '2026-04-30'], ['appartement', '2025-10-10']]);
  assert.deepEqual(atAddress(near, { housenumber: '39 ter', street: 'rue joseph mougin' }).map((d) => d.type), ['maison']);
  assert.deepEqual(atAddress(near, { housenumber: '35', street: 'Rue Inconnue' }), []);
  assert.deepEqual(atAddress(near, { street: 'Rue Joseph Mougin' }), []);
  // 20 avenue de Ségur: 15 DPE within 50 m, 7 of them on the street point ("75107_8909"), none at the 20.
  const segur = parseDpes(fixture('segur-near'));
  assert.equal(segur.filter((d) => d.ban === '75107_8909').length, 7);
  assert.deepEqual(atAddress(segur, CTX.segur), []);
});

test('drops replaced DPE', () => {
  const dpes = parseDpes({ results: [
    { numero_dpe: 'new', numero_dpe_remplace: 'old', etiquette_dpe: 'C', identifiant_ban: 'x_y_00001' },
    { numero_dpe: 'old', etiquette_dpe: 'E', identifiant_ban: 'x_y_00001' },
  ] });
  assert.deepEqual(dpes.map((d) => d.id), ['new']);
});

test('Nancy, 35 rue Joseph Mougin: the building DPE, the street and the commune', () => {
  const v = view('nancy');
  assert.ok(v.facts.length <= 4);
  assert.deepEqual(v.facts.map((f) => [f.label, f.value, f.level]), [
    ['DPE à cette adresse', 'Étiquette D (consommation) / B (émissions)', 'info'],
    ['Dans la rue (Rue Joseph Mougin)', '74 DPE, dont 9 % en F ou G', 'info'],
    ['Dans la commune (Nancy)', '53\u202f742 DPE, dont 7 % en F ou G', 'info'],
  ]);
  assert.equal(v.facts[0].detail, 'DPE de l’immeuble, établi le 30/04/2026. 2 DPE publiés à cette adresse, voir la liste.');
  assert.equal(v.facts[1].detail, 'A : 1, B : 0, C : 5, D : 42, E : 19, F : 5, G : 2.');
  assert.deepEqual(v.items.map((i) => i.detail), ['DPE de l’immeuble du 30/04/2026, 1\u202f496 m²', 'DPE d’un appartement du 10/10/2025, 84 m²']);
  assert.equal(v.source.updated, '23/09/2026');
  assert.equal(v.precision, 'adresse (immeuble), rue et commune');
  assert.doesNotMatch(JSON.stringify(v), /—/);
});

test('an F or G building is a warning, citing the rental ban', () => {
  const near = parseDpes(fixture('nancy-near')).map((d) => ({ ...d, label: 'G' }));
  const f = view('nancy', near).facts[0];
  assert.equal(f.level, 'warn');
  assert.match(f.detail, /1er janvier 2025.*G.*location.*Climat et résilience/);
  assert.ok(view('nancy').notes.some((n) => /2028.*2034/.test(n.text ?? n)));
});

test('Paris, 20 avenue de Ségur: no DPE at the number, counts by district', () => {
  const v = view('segur');
  assert.deepEqual(v.facts.map((f) => f.value), ['Aucun DPE publié pour cette adresse', '267 DPE, dont 25 % en F ou G', '20\u202f751 DPE, dont 25 % en F ou G']);
  assert.equal(v.facts[2].label, 'Dans l’arrondissement (Paris)');
  assert.equal(v.items.length, 0);
});

test('Saint-Véran: a commune, no address and no street', () => {
  const v = view('saint-veran');
  assert.deepEqual(v.facts.map((f) => [f.label, f.value]), [
    ['DPE à cette adresse', 'Adresse sans numéro'],
    ['Dans la commune (Saint-Véran)', '66 DPE, dont 45 % en F ou G'],
  ]);
});
