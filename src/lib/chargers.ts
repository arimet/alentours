// Charging stations from the national IRVE base (data.gouv.fr tabular API, one row per charge point).
import { distance, formatDistance, type BlockView, type Fact, type Item } from './block.ts';
import { frDate, onFoot } from './health.ts';
import { formatWalk, type Walk } from './walk.ts';

type Point = { lat: number; lon: number };
export type Station = Point & {
  name: string; operator?: string; points: number; maxKw?: number;
  access?: string; free?: boolean; distance: number; walk?: Walk;
};

export const IRVE_URL = 'https://www.data.gouv.fr/fr/datasets/5448d3e0c751df01f85d0572/';
const API = 'https://tabular-api.data.gouv.fr/api/resources/eb76d20a-8501-400e-b336-d85724de5435/data/';
/** Bounding-box half-sizes (km): first try, then one wider try if it finds fewer than MIN_STATIONS (rural areas). */
export const MIN_STATIONS = 3;
// Widening step by step keeps each box small enough for the 3-page cap (600 rows, unsorted):
// a dense area stops at 1 or 3 km, only sparse rural areas reach 10 km.
export const RADII = [1, 3, 10];
/** Stations counted in the "nearby" fact, as the crow flies. */
export const COUNT_M = 1000;
export const LISTED = 8;
// ponytail: 3 pages of 200 rows at most; Paris ±1 km is 352 rows, 2 pages.
const MAX_PAGES = 3;

export const irveUrl = (p: Point, km: number) => {
  const dLat = km / 111.32, dLon = km / (111.32 * Math.cos((p.lat * Math.PI) / 180));
  return `${API}?${new URLSearchParams({
    consolidated_latitude__greater: (p.lat - dLat).toFixed(5),
    consolidated_latitude__less: (p.lat + dLat).toFixed(5),
    consolidated_longitude__greater: (p.lon - dLon).toFixed(5),
    consolidated_longitude__less: (p.lon + dLon).toFixed(5),
    columns: 'id_pdc_itinerance,nom_station,adresse_station,nom_operateur,nom_enseigne,puissance_nominale,gratuit,condition_acces,date_maj,consolidated_latitude,consolidated_longitude',
    page_size: '200',
  })}`;
};

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Some station names are technical ids ("Réseau eborn/194a41c4-…", "FR*Y55/1958…"). */
const technical = (s: string) => !s || /\/|^FR\*/i.test(s) || /[0-9a-f]{8}-[0-9a-f]{4}/i.test(s);
/** "YES55 | FR*Y55" → "YES55", "Paris | Avenue de Saxe 10" → "Paris, Avenue de Saxe 10"; "" when only ids. */
const readable = (v: unknown) => clean(v).split('|').map(clean).filter((x) => !technical(x)).join(', ');
/** Declared in kW; a few publishers write watts. */
const kw = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n >= 1000 ? n / 1000 : n) : undefined; };

/**
 * One charge point is often published by several sources: keep its latest `date_maj`.
 * Then group points by position (about 10 m), since station ids differ between publishers.
 */
export const parseIrve = (rows: any[], from: Point): Station[] => {
  const latest = new Map<string, any>();
  for (const r of rows) {
    if (!Number.isFinite(r.consolidated_latitude) || !Number.isFinite(r.consolidated_longitude)) continue;
    const id = clean(r.id_pdc_itinerance) || JSON.stringify(r);
    const prev = latest.get(id);
    if (!prev || String(r.date_maj ?? '') > String(prev.date_maj ?? '')) latest.set(id, r);
  }
  const groups = new Map<string, any[]>();
  for (const r of latest.values()) {
    const key = `${r.consolidated_latitude.toFixed(4)},${r.consolidated_longitude.toFixed(4)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((rs) => {
    const at = { lat: rs[0].consolidated_latitude, lon: rs[0].consolidated_longitude };
    const pick = (...fs: string[]) => fs.flatMap((f) => rs.map((r) => readable(r[f]))).find(Boolean);
    const name = pick('nom_station', 'adresse_station') ?? 'Station sans nom';
    const powers = rs.map((r) => kw(r.puissance_nominale)).filter((n): n is number => n !== undefined);
    const access = rs.some((r) => /libre/i.test(r.condition_acces)) ? 'accès libre' : rs.some((r) => /réservé/i.test(r.condition_acces)) ? 'accès réservé' : undefined;
    const free = rs.some((r) => r.gratuit === true) ? true : rs.some((r) => r.gratuit === false) ? false : undefined;
    return {
      ...at, name, operator: pick('nom_enseigne', 'nom_operateur'),
      points: rs.length, maxKw: powers.length ? Math.max(...powers) : undefined, access, free, distance: distance(from, at),
    };
  }).sort((a, b) => a.distance - b.distance);
};

/** Follows the API's `links.next`, up to MAX_PAGES. */
const fetchRows = async (url: string, get: (url: string) => Promise<any>) => {
  const rows: any[] = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const json = await get(url);
    rows.push(...(json?.data ?? []));
    url = json?.links?.next;
  }
  return rows;
};

/** Small bbox first, then wider ones while it has fewer than MIN_STATIONS. `date`: latest `date_maj` seen. */
export const nearbyStations = async (p: Point, get: (url: string) => Promise<any>) => {
  let rows: any[] = [], stations: Station[] = [];
  for (const km of RADII) {
    rows = await fetchRows(irveUrl(p, km), get);
    stations = parseIrve(rows, p);
    if (stations.length >= MIN_STATIONS) break;
  }
  const date = rows.map((r) => String(r.date_maj ?? '')).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort().at(-1);
  return { stations, date };
};

const fmtKw = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kW`;
const howFar = (s: Station) => s.walk ? formatWalk(s.walk) : `${formatDistance(s.distance)} à vol d’oiseau`;
const freeText = (f?: boolean) => f === true ? 'gratuit' : f === false ? 'payant' : 'gratuité non renseignée';

export const toItem = (s: Station): Item => ({
  name: s.name,
  detail: [
    s.operator,
    `${s.points} point${s.points > 1 ? 's' : ''} de charge`,
    s.maxKw && `jusqu’à ${fmtKw(s.maxKw)}`,
    s.access, freeText(s.free),
  ].filter(Boolean).join(', '),
  distance: s.distance, at: { lat: s.lat, lon: s.lon }, ...(s.walk ? { walk: s.walk } : {}),
});

/** `stations` undefined means the source failed. */
export const chargersView = (data: { stations?: Station[]; date?: string }): BlockView => {
  const stations = data.stations && onFoot(data.stations);
  const listed = (stations ?? []).slice(0, LISTED);
  const updated = frDate(data.date);
  let facts: Fact[];
  if (!stations) facts = [{ label: 'Station la plus proche', value: 'Donnée indisponible', level: 'unknown', detail: 'La source n’a pas répondu.' }];
  else if (!stations.length) facts = [{ label: 'Station la plus proche', value: `Aucune à moins de ${RADII.at(-1)} km`, level: 'info' }];
  else {
    const near = stations.filter((s) => s.distance <= COUNT_M).length;
    const max = Math.max(0, ...listed.map((s) => s.maxKw ?? 0));
    facts = [
      { label: 'Station la plus proche', value: howFar(stations[0]), detail: `${stations[0].name}${stations[0].operator ? `, ${stations[0].operator}` : ''}.` },
      { label: 'Stations à moins de 1 km', value: near ? String(near) : 'Aucune', detail: 'À vol d’oiseau.' },
      ...(max ? [{ label: 'Puissance maximale à proximité', value: `jusqu’à ${fmtKw(max)}`, detail: 'Parmi les stations listées ci-dessous.' }] : []),
    ];
  }
  return {
    facts,
    explanation: 'Les stations de recharge publiques les plus proches, avec leur nombre de points de charge et leur puissance maximale. Les distances sont à pied pour les plus proches, à vol d’oiseau au-delà.',
    items: listed.map(toItem),
    precision: 'au point',
    source: { name: 'Base nationale des IRVE, data.gouv.fr', url: IRVE_URL, updated },
    notes: [
      'Pas de disponibilité en temps réel : une borne listée peut être occupée ou en panne.',
      'La gratuité est rarement renseignée : « gratuité non renseignée » ne veut pas dire payant.',
      'Données déclarées par les opérateurs, consolidées chaque jour. Une station peut manquer ou ne pas être à jour si son opérateur ne publie pas.',
      'Distances à pied : calcul d’itinéraire de la Géoplateforme (IGN).',
    ],
  };
};
