import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { dataUrl, departmentOf } from '../lib/data';
import { internetView } from '../lib/internet';

export const internet: Block = {
  id: 'internet',
  title: 'Internet fixe',
  load: async (ctx) => {
    // No file for a territory Arcep does not cover (Saint-Pierre-et-Miquelon…): the view says so.
    const file = await getJson(dataUrl('internet', departmentOf(ctx.commune)))
      .catch((e) => { if (e instanceof Error && e.message === 'HTTP 404') return {}; throw e; });
    return internetView(file, ctx);
  },
};
