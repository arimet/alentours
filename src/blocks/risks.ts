import type { Block } from '../lib/block';
import { dataUrl, departmentOf } from '../lib/data';
import { getJson } from '../lib/http';
import { LIVE, clayFact, communeFact, floodFact, risksView, sitesItems, urls } from '../lib/risks';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const risks: Block = {
  id: 'risks',
  title: 'Risques',
  load: async (ctx) => {
    const u = urls(ctx);
    // Commune-level fallback (scripts/risks.mjs), fetched alongside the live calls.
    const file = getJson(dataUrl('risks', departmentOf(ctx.commune))).catch(() => undefined);
    // [url, validator that throws on an error payload], in the order of LIVE.
    const calls: [string, (j: any) => unknown][] = [
      [u.rga, (j) => clayFact(j, ctx)],
      [u.tri, floodFact],
      [u.seismic, (j) => communeFact(j, undefined)],
      [u.radon, (j) => communeFact(undefined, j)],
      [u.ssp, (j) => sitesItems(j, undefined, ctx)],
      [u.icpe, (j) => sitesItems(undefined, j, ctx)],
    ];
    // Quota v1: 5 calls/s per IP, so start one call every 200 ms. A 404 means "no result" (tri_zonage spec).
    const settled = await Promise.allSettled(calls.map(([url, validate], i) =>
      wait(i * 200)
        .then(() => getJson(url, { timeout: 8000 }))
        .catch((e) => { if (e?.message === 'HTTP 404') return null; throw e; })
        .then((j) => (validate(j), j))));
    return risksView(settled.map((s) => (s.status === 'fulfilled' ? { value: s.value } : undefined)), await file, ctx);
  },
};
