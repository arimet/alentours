import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { byIdsUrl, carteUrl, matchSecteur, nearestUrl, parseSchools, schoolsView, type School } from '../lib/ecoles';
import { byWalk, walkTo, type Walk } from '../lib/walk';

export const ecoles: Block = {
  id: 'ecoles',
  title: 'Écoles',
  load: async (ctx) => {
    // The carte scolaire is a bonus: if it fails, the sheet falls back to the nearest public collège.
    const secteurP = getJson(carteUrl(ctx.citycode, ctx.street))
      .then((json) => matchSecteur(json, ctx))
      .then(async (ids) => ids.length ? parseSchools('college', await getJson(byIdsUrl(ids, ctx))) : [])
      .catch(() => [] as School[]);
    const [ecole, college, lycee, secteur] = await Promise.all([
      getJson(nearestUrl('ecole', ctx, 40)).then((j) => parseSchools('ecole', j)),
      getJson(nearestUrl('college', ctx, 3)).then((j) => parseSchools('college', j)),
      getJson(nearestUrl('lycee', ctx, 8)).then((j) => parseSchools('lycee', j)),
      secteurP,
    ]);
    // A primaire is both a maternelle and an élémentaire: route each place once (~14 routes at most).
    const cache = new Map<string, Promise<Walk | null>>();
    const walk = (from: typeof ctx, to: { lat: number; lon: number }) => {
      const k = `${to.lat},${to.lon}`;
      if (!cache.has(k)) cache.set(k, walkTo(from, to));
      return cache.get(k)!;
    };
    const pub = ecole.filter((s) => s.public);
    const routed = (await Promise.all([
      byWalk(ctx, pub.filter((s) => s.maternelle), { limit: 4, walk }),
      byWalk(ctx, pub.filter((s) => s.elementaire), { limit: 4, walk }),
      byWalk(ctx, secteur.length ? secteur : college, { limit: 3, walk }),
      byWalk(ctx, lycee.filter((s) => s.gt), { limit: 3, walk }),
      byWalk(ctx, lycee.filter((s) => s.pro), { limit: 2, walk }),
    ])).flat();
    const walks = new Map(routed.flatMap((s) => (s.walk ? [[s.id, s.walk] as const] : [])));
    const add = (xs: School[]) => xs.map((s) => (walks.has(s.id) ? { ...s, walk: walks.get(s.id) } : s));
    return schoolsView({ ecole: add(ecole), college: add(college), lycee: add(lycee), secteur: add(secteur) });
  },
};
