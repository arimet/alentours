import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { AMELI_META_URL, gpUrl, nearbyFiness, parseGps, santeView, type Place } from '../lib/sante';
import { byWalk } from '../lib/walk';

// Routes for the 3 nearest pharmacies and GPs; emergencies stay as the crow flies (one drives there).
const onFoot = (ctx: { lat: number; lon: number }, ps?: Place[]) =>
  ps && byWalk(ctx, ps.map((p) => ({ ...p, at: { lat: p.lat, lon: p.lon } })), { limit: 3 });

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
    const [pharmacies, generalistes] = await Promise.all([
      onFoot(ctx, ok(ph)?.places),
      onFoot(ctx, gps.status === 'fulfilled' ? parseGps(gps.value, ctx) : undefined),
    ]);
    return santeView({
      pharmacies,
      urgences: ok(urg)?.places,
      gps: generalistes,
      finessDate: ok(ph)?.date ?? ok(urg)?.date,
      ameliDate: ok(meta)?.metas?.default?.modified,
    });
  },
};
