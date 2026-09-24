// Airport noise: PEB (plans d'exposition au bruit) and PGS (plans de gêne sonore) of the DGAC, served as vector
// WMS by the Géoplateforme. Pure functions only. See docs/feasibility/air-bruit.md, section 2b.
import type { BlockView, Fact } from './block.ts';

const WMS = 'https://data.geopf.fr/wms-v/ows';
export const PEB = 'dgac_peb_plan_wmsv';
export const PGS = 'dgac_pgs_plan_wmsv';
export const DATASET_URL = 'https://www.geoportail.gouv.fr/donnees/plan-dexposition-au-bruit-peb';

// A tiny box (±0.001°) always answers empty, even on the CDG runway (scale limit of the style). A ±0.05° box
// of 1001 px (about 10 m a pixel) works. The box is centred on the point, so its pixel is I = J = 500.
const HALF = 0.05, SIZE = 1001;

export const gfiUrl = (layer: string, { lat, lon }: { lat: number; lon: number }) => {
  const [minLat, minLon, maxLat, maxLon] = [lat - HALF, lon - HALF, lat + HALF, lon + HALF].map((v) => +v.toFixed(6));
  // Pixel of the point: columns grow eastward from minLon, rows grow southward from maxLat.
  const px = (d: number) => String(Math.min(SIZE - 1, Math.floor((d / (2 * HALF)) * SIZE)));
  return `${WMS}?${new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo', LAYERS: layer, QUERY_LAYERS: layer, STYLES: '',
    // WMS 1.3.0 in EPSG:4326: axis order is lat,lon.
    CRS: 'EPSG:4326', BBOX: [minLat, minLon, maxLat, maxLon].join(','),
    WIDTH: String(SIZE), HEIGHT: String(SIZE), I: px(lon - minLon), J: px(maxLat - lat),
    INFO_FORMAT: 'application/json', FEATURE_COUNT: '5',
  })}`;
};

export type Zone = { zone: string; airport: string; oaci: string; date?: string; doc?: string };

// DGAC names are upper-case abbreviations ("P. CH. DE GAULLE"); the OACI code is the stable key.
const AIRPORTS: Record<string, string> = { LFPG: 'Paris-CDG', LFPO: 'Paris-Orly', LFPB: 'Paris-Le Bourget' };
const airportName = (oaci: string, name: string) => AIRPORTS[oaci] ?? name;

const isoDay = (d?: string) => d?.slice(0, 10);

/** Most exposed zone first (A before D, 1 before 3): overlapping plans are rare, but the worst one counts. */
export const parseZones = (json: any): Zone[] =>
  (json?.features ?? [])
    .map(({ properties: p }: any) => ({
      zone: String(p.zone),
      airport: airportName(p.code_oaci, p.nom),
      oaci: p.code_oaci,
      ...(isoDay(p.date_arret ?? p.date_arrete) ? { date: isoDay(p.date_arret ?? p.date_arrete) } : {}),
      ...(p.ref_doc ? { doc: p.ref_doc } : {}),
    }))
    .sort((a: Zone, b: Zone) => a.zone.localeCompare(b.zone));

const frDate = (iso: string) => iso.split('-').reverse().join('/');

// Code de l'urbanisme, art. L112-7 (zones A, B = loud noise, C = moderate noise, D optional), R112-3 (Lden thresholds:
// A >= 70, B down to 62-65, C down to 55-57, D down to 50) and L112-10 (constructions allowed in each zone).
const PEB_DETAIL: Record<string, string> = {
  A: 'Zone de bruit fort, la plus proche des pistes. Les nouveaux logements y sont presque tous interdits.',
  B: 'Zone de bruit fort. Les nouveaux logements y sont presque tous interdits.',
  C: 'Zone de bruit modéré. Les nouveaux logements y sont très limités, et doivent être isolés du bruit.',
  D: 'Zone de bruit plus faible. On peut y construire, mais les logements neufs doivent être isolés du bruit.',
};
const PEB_LEVEL: Record<string, Fact['level']> = { A: 'alert', B: 'alert', C: 'warn', D: 'info' };

export const noiseView = (peb: Zone[], pgs: Zone[]): BlockView => {
  const p = peb[0], g = pgs[0];
  const facts: Fact[] = [p
    ? { label: 'Zone de bruit d’aéroport', value: `Zone ${p.zone} du PEB de ${p.airport}`, level: PEB_LEVEL[p.zone] ?? 'info', detail: PEB_DETAIL[p.zone] }
    : { label: 'Zone de bruit d’aéroport', value: 'Hors plan d’exposition au bruit d’un aéroport', level: 'ok' }];
  // Code de l'environnement, art. L571-14 to L571-16 and R571-66: zones 1 to 3 of a PGS open the right to an
  // insulation grant for existing homes.
  if (g) facts.push({ label: 'Plan de gêne sonore', value: `Zone ${g.zone} du PGS de ${g.airport}`, level: 'info',
    detail: 'Les riverains peuvent demander une aide pour insonoriser leur logement.' });
  const docs = [p && { name: `Arrêté du PEB de ${p.airport}`, date: p.date, url: p.doc }, g && { name: `Arrêté du PGS de ${g.airport}`, date: g.date, url: g.doc }]
    .filter((d) => d && d.url).map((d) => ({ name: d!.name, url: d!.url, ...(d!.date ? { detail: `du ${frDate(d!.date)}, PDF` } : {}) }));
  return {
    facts,
    explanation: 'Autour des aéroports, le plan d’exposition au bruit (PEB) classe les terrains en zones A et B (bruit fort), C (bruit modéré) et D (bruit plus faible), selon le code de l’urbanisme (articles L112-7 et R112-3). Il limite surtout les nouvelles constructions ; il ne mesure pas le bruit à votre fenêtre.',
    ...(docs.length ? { items: docs } : {}),
    precision: 'zone',
    // The layers carry the date of each arrêté (shown with its document), not a publication date of the whole map.
    source: { name: 'DGAC, via la Géoplateforme (IGN)', url: DATASET_URL },
    notes: ['Le bruit des routes et des voies ferrées n’est pas encore affiché : ces cartes existent seulement pour les grands axes et les grandes agglomérations.'],
  };
};
