import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { chargersView, nearbyStations } from '../lib/chargers';
import { byWalk } from '../lib/walk';

export const chargers: Block = {
  id: 'chargers',
  title: 'Bornes de recharge',
  load: async (ctx) => {
    const { stations, date } = await nearbyStations(ctx, getJson);
    // Routes for the 3 nearest only: the walk queue is shared by the whole page.
    const walked = await byWalk(ctx, stations.map((s) => ({ ...s, at: { lat: s.lat, lon: s.lon } })), { limit: 3 });
    return chargersView({ stations: walked, date });
  },
};
