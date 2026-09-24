import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { noiseView, gfiUrl, parseZones, PEB, PGS } from '../lib/noise';

export const noise: Block = {
  id: 'noise',
  title: 'Bruit',
  load: async (ctx) => {
    try {
      const [peb, pgs] = await Promise.all([PEB, PGS].map(async (l) => parseZones(await getJson(gfiUrl(l, ctx)))));
      return noiseView(peb, pgs);
    } catch { throw new Error('la Géoplateforme ne répond pas'); }
  },
};
