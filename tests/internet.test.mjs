import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, parseDbf, buildEntries } from '../scripts/internet.mjs';
import { internetView, mapUrl, percent } from '../src/lib/internet.ts';

// The department file as the script writes it, from real T2 2026 rows.
const fixture = (name) => readFileSync(new URL(`fixtures/internet-${name}`, import.meta.url));
const file = {
  ...buildEntries({
    fibre: parseDbf(fixture('cartefibre-2026T2.dbf')),
    best: parseCsv(fixture('mci-best.csv').toString()),
    debit: parseCsv(fixture('mci-debit.csv').toString()),
    cuivre: parseCsv(fixture('cuivre.csv').toString()),
  }),
  _meta: {
    sources: [
      { name: 'Arcep, Cartefibre (déploiements FttH), T2 2026', url: 'https://www.data.gouv.fr/datasets/le-marche-du-haut-et-tres-haut-debit-fixe-deploiements', date: '2026-09-10' },
      { name: 'Arcep, Ma connexion internet, données au 30/06/2026', url: 'https://www.data.gouv.fr/datasets/ma-connexion-internet', date: '2026-06-30' },
      { name: 'Fermeture du réseau cuivre (ministère de l’Économie, d’après Orange)', url: 'https://www.data.gouv.fr/datasets/fermeture-du-reseau-cuivre', date: '2025-10-20' },
    ],
  },
};
const ctx = (citycode, commune = citycode) => ({ citycode, commune, lat: 48.850699, lon: 2.308628, label: '', city: '' });
const NBSP = ' ';
const visible = (v) => [v.explanation, v.precision, ...(v.notes ?? []), ...v.facts.flatMap((f) => [f.label, f.value, f.detail ?? '']), ...(v.items ?? []).flatMap((i) => [i.name, i.detail ?? ''])].join('\n');

test('percent never rounds to 0 or 100 when it is not', () => {
  assert.equal(percent(445, 465), `96${NBSP}%`);
  assert.equal(percent(1665810, 1665813), `plus de 99${NBSP}%`);
  assert.equal(percent(3, 1665813), `moins de 1${NBSP}%`);
  assert.equal(percent(0, 10), `0${NBSP}%`);
  assert.equal(percent(10, 10), `100${NBSP}%`);
});

test('the Arcep map opens at the address, buildings layer', () => {
  assert.equal(mapUrl({ lat: 48.850699, lon: 2.308628 }), 'https://maconnexioninternet.arcep.fr/?lat=48.850699&lng=2.308628&zoom=18&mode=debit');
});

test('Paris 7e: fibre of the arrondissement, technologies of the whole city', () => {
  const v = internetView(file, ctx('75107', '75056'));
  assert.equal(v.facts[0].label, 'Fibre dans l’arrondissement');
  assert.equal(v.facts[0].value, `97${NBSP}% des locaux raccordables`);
  assert.equal(v.facts[0].level, 'info');
  assert.match(v.facts[0].detail, /56.176 locaux raccordables sur 57.786/);
  assert.equal(v.facts[1].value, `Fibre pour 96${NBSP}% des locaux`);
  assert.match(v.facts[1].detail, /câble 3.%/);
  assert.match(v.facts[1].detail, /plus de 99.% des locaux peuvent avoir au moins 30 Mbit\/s et 99.% au moins 1 Gbit\/s/);
  assert.match(v.facts[1].detail, /ensemble de Paris/);
  assert.equal(v.facts[2].value, 'Pas encore de date');
  assert.match(v.precision, /arrondissement/);
});

test('Saint-Véran: mostly fibre, a few 4G fixe and satellite', () => {
  const v = internetView(file, ctx('05157'));
  assert.equal(v.facts[0].label, 'Fibre dans la commune');
  assert.equal(v.facts[0].value, `91${NBSP}% des locaux raccordables`);
  assert.match(v.facts[1].detail, /^Autres : 4G fixe 3.%, satellite 1.%\./);
  assert.match(v.facts[1].detail, /99.% des locaux peuvent avoir au moins 30 Mbit\/s et 96.% au moins 1 Gbit\/s/);
  assert.equal(v.precision, 'à la commune');
  assert.equal(v.source.updated, '30/06/2026');
});

test('Fort-de-France: copper closure date', () => {
  const v = internetView(file, ctx('97209'));
  assert.equal(v.facts[2].label, 'Fermeture du réseau cuivre');
  assert.equal(v.facts[2].value, 'Au plus tard le 31/01/2028');
  assert.match(v.facts[2].detail, /ADSL/);
});

test('Lévis-Saint-Nom: copper already closed', () => {
  assert.equal(internetView(file, ctx('78334')).facts[2].value, 'Déjà fermé');
});

test('says clearly that it is the commune, not the home, and links to the map', () => {
  const v = internetView(file, ctx('05157'));
  assert.ok(v.notes.includes('Ces chiffres portent sur l’ensemble de la commune. Pour savoir si votre logement est raccordable, consultez la carte Arcep à l’adresse.'));
  assert.equal(v.items[0].url, mapUrl(ctx('05157')));
  assert.doesNotMatch(visible(v), /—/);
  assert.doesNotMatch(visible(internetView(file, ctx('75107', '75056'))), /—/);
});

test('unknown commune: says the data is missing', () => {
  const v = internetView({ _meta: file._meta }, ctx('97502'));
  assert.equal(v.facts.length, 1);
  assert.equal(v.facts[0].level, 'unknown');
  assert.equal(v.items[0].url, mapUrl(ctx('97502')));
});
