import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { dataUrl, departmentOf } from '../lib/data';
import { climateView } from '../lib/climate';

export const climate: Block = {
  id: 'climate',
  title: 'Climat futur',
  load: async (ctx) => {
    // No file overseas (Climadiag and TRACC-2023 differ there): the view says so.
    const file = await getJson(dataUrl('climate', departmentOf(ctx.commune)))
      .catch((e) => { if (e instanceof Error && e.message === 'HTTP 404') return {}; throw e; });
    return climateView(file, ctx);
  },
};
