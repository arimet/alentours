import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { dataUrl, departmentOf } from '../lib/data';
import { housingView, isCovered, parseStats, statsUrl, uncoveredView } from '../lib/housing';

export const housing: Block = {
  id: 'housing',
  title: 'Immobilier',
  load: async (ctx) => {
    const insee = ctx.citycode; // arrondissement in Paris, Lyon and Marseille: the only level DVF fills there
    if (!isCovered(insee)) return uncoveredView();
    const [stats, dep] = await Promise.allSettled([getJson(statsUrl(insee)), getJson(dataUrl('dvf', departmentOf(insee)))]);
    if (stats.status === 'rejected') throw stats.reason;
    // Missing yearly file (404 or anything else): the view just omits the evolution and says so.
    return housingView({ insee, district: insee !== ctx.commune, stats: parseStats(stats.value), dep: dep.status === 'fulfilled' ? dep.value : undefined });
  },
};
