import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { AMELI_META_URL, gpUrl, nearbyFiness, parseGps, healthView, type Place } from '../lib/health';
import { byWalk } from '../lib/walk';

// Routes for the 3 nearest pharmacies and GPs; emergencies stay as the crow flies (one drives there).
const onFoot = (ctx: { lat: number; lon: number }, ps?: Place[]) =>
  ps && byWalk(ctx, ps.map((p) => ({ ...p, at: { lat: p.lat, lon: p.lon } })), { limit: 2 });

export const health: Block = {
  id: 'health',
  title: 'Santé',
  load: async (ctx) => {
    const [pharm, emerg, gps, meta] = await Promise.allSettled([
      nearbyFiness('pharmacy', ctx, getJson),
      nearbyFiness('emergency', ctx, getJson),
      getJson(gpUrl(ctx)),
      getJson(AMELI_META_URL),
    ]);
    if (pharm.status === 'rejected' && emerg.status === 'rejected' && gps.status === 'rejected') throw pharm.reason;
    const ok = <T>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : undefined);
    const [pharmacies, walkedGps] = await Promise.all([
      onFoot(ctx, ok(pharm)?.places),
      onFoot(ctx, gps.status === 'fulfilled' ? parseGps(gps.value, ctx) : undefined),
    ]);
    return healthView({
      pharmacies,
      emergencies: ok(emerg)?.places,
      gps: walkedGps,
      finessDate: ok(pharm)?.date ?? ok(emerg)?.date,
      ameliDate: ok(meta)?.metas?.default?.modified,
    });
  },
};
