import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sunDay, timeZone, pickBuilding, facades, sunView, buildingUrl, sunFigure } from '../src/lib/sun.ts';

// Real BD TOPO answers (buildingUrl), fetched from data.geopf.fr on 24/09/2026.
const fixture = (n) => JSON.parse(readFileSync(new URL(`fixtures/sun-${n}.json`, import.meta.url)));
const NANCY = { lat: 48.703193, lon: 6.16209, commune: '54395' };
const SEGUR = { lat: 48.850699, lon: 2.308628, commune: '75056' };
const VERAN = { lat: 44.704139, lon: 6.861073, commune: '05157' };
const min = (a, b) => Math.abs(a.getTime() - Date.parse(b)) / 60000;
const visible = (v) => [v.explanation, v.precision, ...v.notes, ...v.facts.flatMap((f) => [f.label, f.value, f.detail ?? ''])].join('\n');

// Reference times: api.sunrise-sunset.org (consulted 24/09/2026), in UTC. Timeanddate gives the same minute
// for Paris on 21 June 2026 (05:45 / 21:59 CEST). Tolerance: 2 minutes.
test('sunrise and sunset match published values within 2 minutes', () => {
  const cases = [
    [48.8566, 2.3522, '2026-06-21', '2026-06-21T03:44:59Z', '2026-06-21T19:59:51Z'],
    [48.8566, 2.3522, '2026-12-21', '2026-12-21T07:39:17Z', '2026-12-21T15:58:01Z'],
    [VERAN.lat, VERAN.lon, '2026-06-21', '2026-06-21T03:45:15Z', '2026-06-21T19:23:30Z'],
    [16.2411, -61.5331, '2026-06-21', '2026-06-21T09:33:57Z', '2026-06-21T22:42:02Z'],
  ];
  for (const [lat, lon, day, rise, set] of cases) {
    const d = sunDay(lat, lon, day);
    assert.ok(min(d.sunrise, rise) < 2, `${day} ${lat} rise ${d.sunrise.toISOString()}`);
    assert.ok(min(d.sunset, set) < 2, `${day} ${lat} set ${d.sunset.toISOString()}`);
  }
});

// Azimuths and noon elevation checked against spherical trigonometry at the solstices (declination ±23.44°):
// cos A = (sin δ + sin φ sin 0.833°) / (cos φ cos 0.833°), noon elevation = 90° − φ ± 23.44°. Paris: 51.6° / 126.0°, 64.6° / 17.7°.
test('solstice azimuths and noon elevation in Paris within 1°', () => {
  const s = sunDay(48.8566, 2.3522, '2026-06-21'), w = sunDay(48.8566, 2.3522, '2026-12-21');
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1, `${a} vs ${b}`);
  near(s.riseAz, 51.6); near(s.setAz, 308.4); near(s.noonElevation, 64.6);
  near(w.riseAz, 126.0); near(w.setAz, 234.0); near(w.noonElevation, 17.7);
});

test('overseas departments get their own time zone', () => {
  assert.equal(timeZone('54395'), 'Europe/Paris');
  assert.equal(timeZone('2A004'), 'Europe/Paris');
  assert.equal(timeZone('97105'), 'America/Guadeloupe');
  assert.equal(timeZone('97209'), 'America/Martinique');
  assert.equal(timeZone('97302'), 'America/Cayenne');
  assert.equal(timeZone('97411'), 'Indian/Reunion');
  assert.equal(timeZone('97611'), 'Indian/Mayotte');
});

test('WFS query: small lat,lon box in EPSG:4326', () => {
  const u = new URL(buildingUrl(NANCY));
  assert.equal(u.searchParams.get('TYPENAMES'), 'BDTOPO_V3:batiment');
  assert.match(u.searchParams.get('BBOX'), /^48\.70\d+,6\.16\d+,48\.70\d+,6\.16\d+,urn:ogc:def:crs:EPSG::4326$/);
});

test('picks the building containing the address, else the nearest within 15 m', () => {
  assert.equal(pickBuilding(fixture('nancy'), NANCY).feature.id, 'batiment.33246067');
  assert.equal(pickBuilding(fixture('segur'), SEGUR).feature.id, 'batiment.5796415');
  assert.ok(pickBuilding(fixture('saint-veran'), VERAN));
  assert.equal(pickBuilding(fixture('nancy'), { lat: 48.7, lon: 6.16 }), null);
});

test('façade directions weighted by length, party walls left out', () => {
  // A 20 m (east-west) by 10 m box: long façades face north and south.
  const d = 1 / 111195, c = 1 / (111195 * Math.cos(45 * Math.PI / 180));
  const box = [[0, 0], [20 * c, 0], [20 * c, 10 * d], [0, 10 * d], [0, 0]].map(([x, y]) => [5 + x, 45 + y]);
  const f = facades(box, 45, []);
  assert.deepEqual(f.main, ['nord', 'sud']);
  assert.ok(Math.abs(f.south - 1 / 3) < 0.01);
  // Its north wall shared with a neighbour: south faces most of what is left.
  const g = facades(box, 45, [[[5, 45 + 10 * d], [5 + 20 * c, 45 + 10 * d]]]);
  assert.equal(g.main[0], 'sud');
  assert.ok(Math.abs(g.south - 0.5) < 0.01);
});

test('Nancy: sheet with today, both solstices and the building', () => {
  const v = sunView(fixture('nancy'), NANCY, new Date('2026-09-24T10:00:00Z'));
  assert.equal(v.facts.length, 4);
  assert.equal(v.facts[0].label, 'Lever et coucher aujourd’hui');
  assert.match(v.facts[0].value, /^lever 7 h \d\d, coucher 19 h \d\d$/);
  assert.match(v.facts[1].detail, /se lève au nord-est et se couche au nord-ouest/);
  assert.match(v.facts[2].detail, /se lève au sud-est et se couche au sud-ouest/);
  assert.match(v.facts[2].detail, /18° au-dessus de l’horizon à midi/);
  assert.equal(v.facts[3].value, 'Façades principales vers l’est et l’ouest');
  assert.match(v.facts[3].detail, /Résidentiel, 4 étages, 10,8 m de haut/);
  assert.ok(v.facts.every((f) => f.level === 'info'));
  assert.equal(v.precision, 'à l’adresse (bâtiment le plus proche)');
  assert.match(v.source.updated, /24\/09\/2026/);
  assert.match(v.figure, /^<svg/);
  assert.ok(v.figureLabel);
  assert.ok(!v.figure.includes('Résidentiel'));
  assert.doesNotMatch(visible(v), /—/);
});

test('Ségur: a large building, times in Paris', () => {
  const v = sunView(fixture('segur'), SEGUR, new Date('2026-06-21T10:00:00Z'));
  assert.match(v.facts[0].value, /^lever 5 h 4\d, coucher 21 h 5\d$/);
  assert.match(v.facts[3].detail, /Commercial et services, 10 étages, 27,1 m de haut/);
});

test('no building found: sun facts only, building marked unknown', () => {
  const v = sunView({ features: [] }, VERAN, new Date('2026-09-24T10:00:00Z'));
  assert.equal(v.facts[3].level, 'unknown');
  assert.match(v.figure, /^<svg/);
  const w = sunView(null, VERAN, new Date('2026-09-24T10:00:00Z'));
  assert.equal(w.facts[3].level, 'unknown');
});

test('overseas: Guadeloupe times in local time', () => {
  const v = sunView({ features: [] }, { lat: 16.2411, lon: -61.5331, commune: '97120' }, new Date('2026-06-21T12:00:00Z'));
  assert.match(v.facts[0].value, /^lever 5 h 3\d, coucher 18 h 4\d$/);
});

test('figure is numbers and fixed labels only', () => {
  const s = sunFigure(null, sunDay(48.85, 2.35, '2026-06-21'), sunDay(48.85, 2.35, '2026-12-21'));
  assert.match(s, /^<svg[^>]*viewBox="0 0 200 200"/);
  assert.match(s, /class="fig-summer"/);
  assert.match(s, /class="fig-winter"/);
});
