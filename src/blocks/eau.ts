import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { PARAMS, buildView, resultsUrl, udiUrl } from '../lib/eau';

export const eau: Block = {
  id: 'eau',
  title: 'Eau du robinet',
  load: async (ctx) => {
    const year = new Date().getFullYear();
    const urls = [
      udiUrl(ctx.commune, year),
      ...[PARAMS.ecoli, PARAMS.nitrates, PARAMS.pfas, PARAMS.pesticides].map((code) => resultsUrl(ctx.commune, code, year)),
    ];
    // Each call on its own: a failed one only blanks its own fact (null answer).
    const answers = (await Promise.allSettled(urls.map((u) => getJson(u)))).map((r) => (r.status === 'fulfilled' ? r.value : null));
    if (answers.every((a) => a === null)) throw new Error('le service Hub’Eau ne répond pas');
    const [udi, conformite, nitrates, pfas, pesticides] = answers;
    return buildView({ udi, conformite, nitrates, pfas, pesticides });
  },
};
