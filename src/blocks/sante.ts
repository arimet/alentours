import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { AMELI_META_URL, gpUrl, nearbyFiness, parseGps, santeView } from '../lib/sante';

export const sante: Block = {
  id: 'sante',
  title: 'Santé',
  load: async (ctx) => {
    const [ph, urg, gps, meta] = await Promise.allSettled([
      nearbyFiness('pharmacie', ctx, getJson),
      nearbyFiness('urgences', ctx, getJson),
      getJson(gpUrl(ctx)),
      getJson(AMELI_META_URL),
    ]);
    if (ph.status === 'rejected' && urg.status === 'rejected' && gps.status === 'rejected') throw ph.reason;
    const ok = <T>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : undefined);
    return santeView({
      pharmacies: ok(ph)?.places,
      urgences: ok(urg)?.places,
      gps: gps.status === 'fulfilled' ? parseGps(gps.value, ctx) : undefined,
      finessDate: ok(ph)?.date ?? ok(urg)?.date,
      ameliDate: ok(meta)?.metas?.default?.modified,
    });
  },
};
