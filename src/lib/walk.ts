// Walking distances from the Géoplateforme route service (IGN, pedestrian profile on the BD TOPO
// road graph). CORS *, no key, ratelimit-limit 10/s: calls are spaced out and cached.
import { formatDistance } from './block.ts';
import { getJson } from './http.ts';

type Point = { lat: number; lon: number };
export type Walk = { m: number; min: number; /** [lon, lat] pairs, to draw the route. */ line: [number, number][] };

/** Walking makes no sense beyond this crow-fly distance: those keep "à vol d’oiseau". */
export const MAX_WALK_M = 3000;
/** Only the nearest few candidates (as the crow flies) get a route: the nearest on foot is among them. */
export const CANDIDATES = 5;

export const walkUrl = (from: Point, to: Point) =>
  `https://data.geopf.fr/navigation/itineraire?${new URLSearchParams({
    resource: 'bdtopo-osrm', profile: 'pedestrian', optimization: 'shortest',
    start: `${from.lon},${from.lat}`, end: `${to.lon},${to.lat}`,
    distanceUnit: 'meter', timeUnit: 'minute', getSteps: 'false', geometryFormat: 'geojson',
  })}`;

export const parseWalk = (json: any): Walk | null =>
  Number.isFinite(json?.distance) && Number.isFinite(json?.duration)
    ? { m: Math.round(json.distance), min: Math.max(1, Math.round(json.duration)), line: json.geometry?.coordinates ?? [] }
    : null;

/** "à 840 m à pied, 13 min". */
export const formatWalk = (w: Walk) => `${formatDistance(w.m)} à pied, ${w.min} min`;

// ponytail: one global queue at 8 requests/s for the whole page; enough for ~30 routes a sheet.
const GAP_MS = 125;
let next = 0;
const slot = () => {
  const at = Math.max(Date.now(), next);
  next = at + GAP_MS;
  return new Promise((r) => setTimeout(r, at - Date.now()));
};

export const walkTo = async (from: Point, to: Point): Promise<Walk | null> => {
  await slot();
  try { return parseWalk(await getJson(walkUrl(from, to), { timeout: 6000 })); } catch { return null; }
};

/**
 * Adds `walk` to the nearest CANDIDATES within MAX_WALK_M (as the crow flies) and sorts by it:
 * walked ones first by walking distance, then the others by crow-fly distance.
 * A failed route keeps its crow-fly distance, so the list still shows.
 */
export const byWalk = async <T extends { distance: number; at?: Point }>(
  from: Point, xs: T[], { limit = CANDIDATES, walk = walkTo } = {},
): Promise<(T & { walk?: Walk })[]> => {
  const sorted = [...xs].sort((a, b) => a.distance - b.distance);
  const done = await Promise.all(sorted.map(async (x, i) =>
    i < limit && x.at && x.distance <= MAX_WALK_M ? { ...x, ...(await walk(from, x.at).then((w) => (w ? { walk: w } : {}))) } : x));
  const key = (x: T & { walk?: Walk }) => [x.walk ? 0 : 1, x.walk?.m ?? x.distance];
  return done.sort((a, b) => { const [ka, da] = key(a), [kb, db] = key(b); return ka - kb || da - db; });
};
