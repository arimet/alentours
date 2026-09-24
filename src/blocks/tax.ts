import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { taxUrl, taxView } from '../lib/tax';

export const tax: Block = {
  id: 'tax',
  title: 'Taxe foncière',
  load: async (ctx) => taxView(await getJson(taxUrl(ctx.commune)), ctx),
};
