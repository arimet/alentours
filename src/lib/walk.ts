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

// ponytail: one global queue at 8 requests/s for the whole page. The Géoplateforme answers 429 past
// about 10 requests/s per IP (the map tiles come from the same host): a 429 pauses the whole queue
// for the Retry-After it sends (4 to 5 s), then tries again. A new sheet drops what is still queued.
const GAP_MS = 125, RETRY_MS = 5000, TRIES = 3;
let generation = 0, pauseUntil = 0, pumping = false;

// Waiting routes, served one every GAP_MS, lowest `priority` first (0 = the theme shown by default).
type Job = { priority: number; order: number; go: () => void };
const queue: Job[] = [];
let order = 0;
const pump = () => {
  if (pumping) return;
  pumping = true;
  const tick = () => {
    if (!queue.length) { pumping = false; return; }
    setTimeout(() => {
      queue.sort((x, y) => x.priority - y.priority || x.order - y.order);
      queue.shift()?.go();
      setTimeout(tick, GAP_MS);
    }, Math.max(0, pauseUntil - Date.now()));
  };
  tick();
};
const slot = (priority: number) => new Promise<void>((go) => { queue.push({ priority, order: order++, go }); pump(); });

/** Called when another address is opened: routes queued for the previous one are dropped. */
export const resetWalks = () => {
  generation++;
  for (const job of queue.splice(0)) job.go(); // they wake up, see the new generation and give up
};

export const walkTo = async (
  from: Point, to: Point,
  { get = getJson, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), priority = 1 } = {},
): Promise<Walk | null> => {
  const gen = generation;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    await slot(priority);
    if (gen !== generation) return null;
    try { return parseWalk(await get(walkUrl(from, to), { timeout: 6000 })); } catch (e) {
      if (!/HTTP 429/.test(String(e)) || attempt === TRIES) return null;
      pauseUntil = Math.max(pauseUntil, Date.now() + RETRY_MS); // every queued route waits too
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
