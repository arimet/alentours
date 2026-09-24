import type { Block } from '../lib/block';
import { getJson } from '../lib/http';
import { byIdsUrl, carteUrl, matchSecteur, nearestUrl, parseSchools, schoolsView } from '../lib/ecoles';

export const ecoles: Block = {
  id: 'ecoles',
  title: 'Écoles',
  load: async (ctx) => {
    // The carte scolaire is a bonus: if it fails, the sheet falls back to the nearest public collège.
    const secteur = getJson(carteUrl(ctx.citycode, ctx.street))
      .then((json) => matchSecteur(json, ctx))
      .then(async (ids) => ids.length ? parseSchools('college', await getJson(byIdsUrl(ids, ctx))) : [])
      .catch(() => []);
    const [ecole, college, lycee] = await Promise.all([
      getJson(nearestUrl('ecole', ctx, 40)).then((j) => parseSchools('ecole', j)),
      getJson(nearestUrl('college', ctx, 1)).then((j) => parseSchools('college', j)),
      getJson(nearestUrl('lycee', ctx, 6)).then((j) => parseSchools('lycee', j)),
    ]);
    return schoolsView({ ecole, college, lycee, secteur: await secteur });
  },
};
