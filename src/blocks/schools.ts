import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { byIdsUrl, catchmentUrl, matchCatchment, nearestUrl, parseSchools, schoolsView, type School } from '../lib/schools';
import { byWalk, walkTo, type Walk } from '../lib/walk';

export const schools: Block = {
  id: 'schools',
  title: 'Écoles',
  load: async (ctx) => {
    // The "carte scolaire" (catchment map) is a bonus: if it fails, the sheet falls back to the nearest public collège.
    const catchmentP = getJson(catchmentUrl(ctx.citycode, ctx.street))
      .then((json) => matchCatchment(json, ctx))
      .then(async (ids) => ids.length ? parseSchools('middle', await getJson(byIdsUrl(ids, ctx))) : [])
      .catch(() => [] as School[]);
    const [primary, middle, high, catchment] = await Promise.all([
      getJson(nearestUrl('primary', ctx, 40)).then((j) => parseSchools('primary', j)),
      getJson(nearestUrl('middle', ctx, 3)).then((j) => parseSchools('middle', j)),
      getJson(nearestUrl('high', ctx, 8)).then((j) => parseSchools('high', j)),
      catchmentP,
    ]);
    // A "primaire" is both a preschool and an elementary school: route each place once (~14 routes at most).
    const cache = new Map<string, Promise<Walk | null>>();
    const walk = (from: typeof ctx, to: { lat: number; lon: number }) => {
      const k = `${to.lat},${to.lon}`;
      if (!cache.has(k)) cache.set(k, walkTo(from, to));
      return cache.get(k)!;
    };
    const publics = primary.filter((s) => s.public);
    const routed = (await Promise.all([
      byWalk(ctx, publics.filter((s) => s.preschool), { limit: 4, walk }),
      byWalk(ctx, publics.filter((s) => s.elementary), { limit: 4, walk }),
      byWalk(ctx, catchment.length ? catchment : middle, { limit: 3, walk }),
      byWalk(ctx, high.filter((s) => s.gt), { limit: 3, walk }),
      byWalk(ctx, high.filter((s) => s.pro), { limit: 2, walk }),
    ])).flat();
    const walks = new Map(routed.flatMap((s) => (s.walk ? [[s.id, s.walk] as const] : [])));
    const add = (xs: School[]) => xs.map((s) => (walks.has(s.id) ? { ...s, walk: walks.get(s.id) } : s));
    return schoolsView({ primary: add(primary), middle: add(middle), high: add(high), catchment: add(catchment) });
  },
};
