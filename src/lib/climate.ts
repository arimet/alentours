// Future climate at the commune, from the files built by scripts/climate.mjs (Météo-France).
// Pure functions only, tested against real Climadiag v411 and TRACC-2023 rows in tests/fixtures/climate-*.

import type { BlockView, Context, Fact } from './block.ts';

/** [ref 1976-2005, low, median, high at +2 °C, the same at +2.7 °C, the same at +4 °C]. */
type Series = number[];
/** One commune of public/data/climate/<dep>.json. See scripts/climate.mjs. */
export type Entry = { d30?: Series; d35?: Series; n20?: Series; hw?: Series; fire?: Series; dry?: Series };
export type File = Record<string, Entry> & { _meta?: { version: string; date: string } };

const WHOLE: Record<string, string> = { '75056': 'Paris', '69123': 'Lyon', '13055': 'Marseille' };
const CLIMADIAG = 'https://meteofrance.com/climadiag-commune';

const FACTS: [keyof Entry, string][] = [
  ['d30', 'Jours à 30 °C ou plus'],
  ['d35', 'Jours à 35 °C ou plus'],
  ['n20', 'Nuits à plus de 20 °C'],
  ['hw', 'Jours de vague de chaleur'],
];

const fact = (label: string, s: Series): Fact => {
  const [ref, , m2, , lo27, m27, hi27, , m4] = s;
  return {
    label,
    value: `${ref} par an en 1976-2005, ${m27} vers 2050`,
    level: 'info',
    detail: [
      `Vers 2030 (+2 °C) : ${m2} par an.`,
      `Vers 2100 (+4 °C) : ${m4} par an.`,
      lo27 !== hi27 && `Selon les modèles, entre ${lo27} et ${hi27} vers 2050.`,
    ].filter(Boolean).join(' '),
  };
};

export const climateView = (file: File, ctx: Pick<Context, 'citycode' | 'commune'>): BlockView => {
  const e = file[ctx.commune];
  const facts = e ? FACTS.filter(([k]) => e[k]).map(([k, label]) => fact(label, e[k]!)) : [];
  const meta = file._meta;
  const whole = ctx.citycode !== ctx.commune && WHOLE[ctx.commune];
  return {
    facts: facts.length ? facts : [{ label: 'Climat futur', value: 'Donnée indisponible pour cette commune', level: 'unknown' }],
    explanation: 'Ces chiffres suivent la Trajectoire de réchauffement de référence pour l’adaptation au changement climatique (TRACC), celle que le gouvernement retient pour se préparer : +2 °C vers 2030, +2,7 °C vers 2050 et +4 °C vers 2100 en France hexagonale, par rapport au début de l’ère industrielle. Ils comparent le climat attendu à ces horizons à celui de la période 1976-2005.',
    precision: 'à la commune',
    source: {
      name: 'Météo-France, Climadiag Commune et DRIAS (Explore2, TRACC-2023)',
      url: CLIMADIAG,
      ...(meta ? { updated: `version du ${meta.date.split('-').reverse().join('/')}` } : {}),
    },
    notes: [
      ...(e ? [] : ['Ces projections couvrent seulement l’Hexagone et la Corse.']),
      'Ce sont des projections de modèles climatiques sur une maille d’environ 8 km retenue pour la commune, pas une prévision pour votre rue.',
      'Chaque valeur est la médiane de plusieurs modèles. La fourchette donne l’écart entre les modèles.',
      ...(whole ? [`Chiffres pour l’ensemble de ${whole}.`] : []),
      { text: 'D’autres indicateurs (sécheresse des sols, risque de feu, pluies) sont sur Climadiag Commune.', link: { label: 'Climadiag Commune', url: CLIMADIAG } },
    ],
  };
};
