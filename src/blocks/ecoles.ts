import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { nearestUrl, parseSchools, schoolsView, type Level } from '../lib/ecoles';

// How many of each level the list shows.
const LIMITS: Record<Level, number> = { ecole: 3, college: 2, lycee: 2 };

export const ecoles: Block = {
  id: 'ecoles',
  title: 'Écoles',
  load: async (ctx) => {
    const levels = Object.keys(LIMITS) as Level[];
    const lists = await Promise.all(levels.map(async (l) => parseSchools(l, await getJson(nearestUrl(l, ctx, LIMITS[l])))));
    return schoolsView(Object.fromEntries(levels.map((l, i) => [l, lists[i]])) as Record<Level, ReturnType<typeof parseSchools>>);
  },
};
