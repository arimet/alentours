import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { bruitView, gfiUrl, parseZones, PEB, PGS } from '../lib/bruit';

export const bruit: Block = {
  id: 'bruit',
  title: 'Bruit',
  load: async (ctx) => {
    try {
      const [peb, pgs] = await Promise.all([PEB, PGS].map(async (l) => parseZones(await getJson(gfiUrl(l, ctx)))));
      return bruitView(peb, pgs);
    } catch { throw new Error('la Géoplateforme ne répond pas'); }
  },
};
