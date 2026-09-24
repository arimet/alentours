import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { airView, indexUrl, parseIndices } from '../lib/air';

const fetchIndices = async (insee: string) => {
  try { return parseIndices(await getJson(indexUrl(insee))); }
  catch { throw new Error('le service d’Atmo France ne répond pas'); }
};

export const air: Block = {
  id: 'air',
  title: 'Air',
  load: async (ctx) => {
    // Paris, Lyon and Marseille districts have their own index (75107…); fall back to the whole commune if not.
    let indices = await fetchIndices(ctx.citycode);
    if (!indices.length && ctx.commune !== ctx.citycode) indices = await fetchIndices(ctx.commune);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    return airView(indices, today);
  },
};
