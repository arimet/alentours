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

// ponytail: one global queue at 4 requests/s for the whole page. The Géoplateforme answers 429 past
// about 10 requests/s per IP, and the map tiles come from the same host. A 429 waits for the
// Retry-After it sends (4 to 5 s) and tries again; a new sheet drops what is still queued.
const GAP_MS = 250, RETRY_MS = 5000, TRIES = 3;
let next = 0, generation = 0;
const slot = () => {
  const at = Math.max(Date.now(), next);
  next = at + GAP_MS;
  return new Promise((r) => setTimeout(r, at - Date.now()));
};

/** Called when another address is opened: routes queued for the previous one are dropped. */
export const resetWalks = () => { generation++; next = 0; };

export const walkTo = async (
  from: Point, to: Point,
  { get = getJson, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) } = {},
): Promise<Walk | null> => {
  const gen = generation;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    await slot();
    if (gen !== generation) return null;
    try { return parseWalk(await get(walkUrl(from, to), { timeout: 6000 })); } catch (e) {
      if (!/HTTP 429/.test(String(e)) || attempt === TRIES) return null;
      await sleep(RETRY_MS);
      if (gen !== generation) return null;
    }
  }
  return null;
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
