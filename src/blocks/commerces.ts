import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { dataUrl, departmentOf } from '../lib/data';
import { candidates, commercesView } from '../lib/commerces';
import { byWalk } from '../lib/walk';

export const commerces: Block = {
  id: 'commerces',
  title: 'Commerces et services',
  load: async (ctx) => {
    // No file where the BPE has no usable point (Mayotte, Saint-Pierre-et-Miquelon…): the view says so.
    const file = await getJson(dataUrl('commerces', departmentOf(ctx.commune)))
      .catch((e) => { if (e instanceof Error && e.message === 'HTTP 404') return {}; throw e; });
    // The 2 nearest of each of the 8 types, routed on foot (16 routes at most).
    const near = await Promise.all(candidates(file, ctx).map((xs) => byWalk(ctx, xs)));
    return commercesView(file, ctx, near);
  },
};
