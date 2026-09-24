import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { dataUrl, departmentOf } from '../lib/data';
import { commercesView } from '../lib/commerces';

export const commerces: Block = {
  id: 'commerces',
  title: 'Commerces et services',
  load: async (ctx) => {
    // No file where the BPE has no usable point (Mayotte, Saint-Pierre-et-Miquelon…): the view says so.
    const file = await getJson(dataUrl('commerces', departmentOf(ctx.commune)))
      .catch((e) => { if (e instanceof Error && e.message === 'HTTP 404') return {}; throw e; });
    return commercesView(file, ctx);
  },
};
