import type { Block, Fact } from '../lib/block';
import { getJson } from '../lib/http';
import { RAYON, argilesFact, communeFact, inondationFact, rapportUrl, sitesItems, urls } from '../lib/risques';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const risques: Block = {
  id: 'risques',
  title: 'Risques',
  load: async (ctx) => {
    const u = urls(ctx);
    // [name shown if missing, url, validator that throws on an error payload]
    const calls: [string, string, (j: any) => unknown][] = [
      ['les argiles', u.rga, (j) => argilesFact(j, ctx)],
      ['les inondations', u.tri, inondationFact],
      ['la sismicité', u.sismique, (j) => communeFact(j, undefined)],
      ['le radon', u.radon, (j) => communeFact(undefined, j)],
      ['les sites pollués', u.ssp, (j) => sitesItems(j, undefined, ctx)],
      ['les installations classées', u.icpe, (j) => sitesItems(undefined, j, ctx)],
    ];
    // Quota v1: 5 calls/s per IP, so start one call every 200 ms. A 404 means "no result" (tri_zonage spec).
    const settled = await Promise.allSettled(calls.map(([, url, validate], i) =>
      wait(i * 200)
        .then(() => getJson(url, { timeout: 8000 }))
        .catch((e) => { if (e?.message === 'HTTP 404') return null; throw e; })
        .then((j) => (validate(j), j))));
    if (settled.every((s) => s.status === 'rejected')) throw new Error('Géorisques ne répond pas');

    const [rga, tri, sismique, radon, ssp, icpe] = settled.map((s) => (s.status === 'fulfilled' ? s.value : undefined));
    const ok = (i: number) => settled[i].status === 'fulfilled';
    const facts: Fact[] = [];
    if (ok(1)) facts.push(inondationFact(tri));
    if (ok(0)) facts.push(argilesFact(rga, ctx));
    if (ok(2) || ok(3)) facts.push(communeFact(sismique, radon));

    // ponytail: page_size 50 per source, so a very dense area can list more sites than it counts; add paging if needed.
    const { items, more } = sitesItems(ssp, icpe, ctx);
    const notes: string[] = [];
    if (more) notes.push(`${more} autre${more > 1 ? 's' : ''} site${more > 1 ? 's' : ''} dans un rayon de ${RAYON / 1000} km, visibles sur Géorisques.`);
    if (!items.length && ok(4) && ok(5)) notes.push(`Aucun site pollué ni installation classée recensé dans un rayon de ${RAYON / 1000} km.`);
    const missing = calls.filter((_, i) => !ok(i)).map(([name]) => name);
    if (missing.length) notes.push(`Géorisques n’a pas répondu pour ${missing.join(', ')}.`);

    return {
      facts,
      explanation: 'Ces cartes officielles disent à quels risques connus le lieu est exposé. Elles ne décrivent pas l’état de votre logement.',
      items,
      precision: 'au point pour les argiles et les inondations, à la commune pour la sismicité et le radon',
      source: { name: 'Géorisques (BRGM, ministère de la Transition écologique)', url: rapportUrl(ctx) },
      notes,
    };
  },
};
