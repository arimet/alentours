import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { buildingUrl, sunView } from '../lib/sun';

export const sun: Block = {
  id: 'sun',
  title: 'Soleil et orientation',
  // The sun part is pure computation: a failing building query only leaves the orientation unknown.
  load: async (ctx) => sunView(await getJson(buildingUrl(ctx)).catch(() => null), ctx, new Date()),
};
