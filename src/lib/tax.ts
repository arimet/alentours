// Taxe foncière rates of the commune, live from the DGFiP "Fiscalité locale des particuliers" dataset
// (data.economie.gouv.fr, one row per commune and year). Pure functions, tested against real responses.

import type { BlockView, Context, Fact } from './block.ts';

type Row = {
  exercice: string; libcom: string; q03: string | null;
  e12vote: number | null; e32vote: number | null; e22: number | null; e52: number | null; e52a: number | null;
  e52tasa: number | null; e52ggemapi: number | null; taux_global_tfb: number | null; taux_plein_teom: number | null;
};
export type Response = { results: Row[] };

const DATASET = 'https://data.economie.gouv.fr/explore/dataset/fiscalite-locale-des-particuliers/';
const WHOLE: Record<string, string> = { '75056': 'Paris', '69123': 'Lyon', '13055': 'Marseille' };
const FIELDS = 'exercice,libcom,q03,e12vote,e32vote,e22,e52,e52a,e52tasa,e52ggemapi,taux_global_tfb,taux_plein_teom';

/** All years (2021 to the latest) in one small query. Paris, Lyon, Marseille: whole-commune code only. */
export const taxUrl = (commune: string) => {
  const u = new URL('https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers/records');
  u.search = new URLSearchParams({ where: `insee_com="${commune}"`, select: FIELDS, order_by: 'exercice desc', limit: '10' }).toString();
  return u.toString();
};

const num = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const pct = (n: number) => `${num(n)} %`;

export const taxView = (res: Response, ctx: Pick<Context, 'citycode' | 'commune'>): BlockView => {
  const rows = res.results.filter((r) => r.taux_global_tfb != null);
  const [last] = rows, first = rows.at(-1);
  const whole = ctx.citycode !== ctx.commune && WHOLE[ctx.commune];
  const facts: Fact[] = [];

  if (last) {
    facts.push({ label: `Taux global ${last.exercice} (propriétés bâties)`, value: pct(last.taux_global_tfb!), level: 'info', detail: 'Toutes collectivités confondues, hors ordures ménagères.' });
    const others = ([['syndicats', last.e52], ['taxes spéciales', (last.e52a ?? 0) + (last.e22 ?? 0)], ['taxe additionnelle Île-de-France', last.e52tasa], ['GEMAPI (prévention des inondations)', last.e52ggemapi]] as const)
      .filter(([, v]) => v);
    facts.push({
      label: 'Qui vote ce taux',
      value: `Commune ${pct(last.e12vote ?? 0)}`,
      detail: [
        `${last.q03 ?? 'Intercommunalité'} : ${pct(last.e32vote ?? 0)}.`,
        others.length && `Autres : ${others.map(([k, v]) => `${k} ${pct(v!)}`).join(', ')}.`,
      ].filter(Boolean).join(' '),
    });
    if (first && first !== last) {
      const d = Math.round((last.taux_global_tfb! - first.taux_global_tfb!) * 100) / 100;
      facts.push({
        label: `Évolution depuis ${first.exercice}`,
        value: d === 0 ? `Stable depuis ${first.exercice}` : `${d > 0 ? '+' : '−'}${num(Math.abs(d))} point${Math.abs(d) >= 2 ? 's' : ''} depuis ${first.exercice}`,
        detail: `${pct(first.taux_global_tfb!)} en ${first.exercice}, ${pct(last.taux_global_tfb!)} en ${last.exercice}.`,
      });
    }
    facts.push(last.taux_plein_teom
      ? { label: 'Taxe d’ordures ménagères (TEOM)', value: pct(last.taux_plein_teom), detail: 'S’ajoute à la taxe foncière, sur la même base. Elle peut varier selon le quartier.' }
      : { label: 'Taxe d’ordures ménagères (TEOM)', value: 'Aucun taux publié', detail: 'Le ramassage peut être financé autrement, par exemple par une redevance.' });
  } else facts.push({ label: 'Taxe foncière', value: 'Donnée indisponible pour cette commune', level: 'unknown' });

  return {
    facts,
    explanation: 'La taxe foncière se calcule ainsi : valeur locative cadastrale du logement (environ la moitié d’un loyer théorique annuel) multipliée par ce taux. Le site ne connaît pas la valeur locative de votre logement : demandez au vendeur son dernier avis de taxe foncière.',
    precision: whole ? `à la commune (taux unique pour l’ensemble de ${whole})` : 'à la commune',
    source: { name: 'DGFiP, Fiscalité locale des particuliers (data.economie.gouv.fr)', url: DATASET, ...(last ? { updated: `exercice ${last.exercice}` } : {}) },
    notes: [
      'Les taux sont votés chaque année par la commune, l’intercommunalité et les syndicats. Ceux de l’année en cours ne sont pas encore publiés.',
      'À Paris, Lyon et Marseille, le taux est le même pour tous les arrondissements.',
      'Pendant la fusion de communes ou d’intercommunalités, le taux de votre avis peut différer légèrement de celui-ci.',
    ],
  };
};
