import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { aggUrl, energyView, metaUrl, nearUrl, parseCounts, parseDpes, parseUpdated } from '../lib/energy';

export const energy: Block = {
  id: 'energy',
  title: 'Énergie des logements (DPE)',
  load: async (ctx) => {
    const [near, street, place, updated] = await Promise.all([
      ctx.housenumber && ctx.street ? getJson(nearUrl(ctx)).then(parseDpes) : [],
      ctx.street ? getJson(aggUrl(ctx.citycode, ctx.street)).then(parseCounts) : undefined,
      getJson(aggUrl(ctx.citycode)).then(parseCounts),
      // The update date is a bonus: the sheet still shows the DPE without it.
      getJson(metaUrl()).then(parseUpdated).catch(() => undefined),
    ]);
    return energyView({ near, street, place, ctx, updated });
  },
};
