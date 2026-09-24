// Property prices from DVF (DGFiP sales, aggregated by data.gouv.fr). Pure functions, tested on real answers.
// Live: "Statistiques DVF", whole period, through the tabular API (CORS *). Yearly series: public/data/dvf/<dep>.json,
// built by scripts/dvf.mjs with the same method.

import type { BlockView, Fact, Item } from './block.ts';
import { departmentOf } from './data.ts';

export const DATASET_URL = 'https://www.data.gouv.fr/fr/datasets/statistiques-dvf/';
const STATS = 'https://tabular-api.data.gouv.fr/api/resources/851d342f-9c96-41c1-924a-11a7a7aae8a6/data/';

/** Same threshold as scripts/dvf.mjs (our choice: the official statistics have none). */
export const MIN_SALES = 5;

/** DVF covers neither Alsace, Moselle (land register kept by the courts) nor Mayotte. */
export const isCovered = (insee: string) => !['57', '67', '68', '976'].includes(departmentOf(insee));

/** Commune code as the geocoder gives it: Paris, Lyon and Marseille only have data per arrondissement. */
export const statsUrl = (insee: string) => `${STATS}?code_geo__exact=${encodeURIComponent(insee)}`;

/** The explorer reads ?level=commune&code= on load (checked in its bundle, 24/09/2026). */
export const explorerUrl = (insee: string) => `https://explore.data.gouv.fr/fr/immobilier?level=commune&code=${encodeURIComponent(insee)}`;

type Kind = 'appartement' | 'maison';
export type Stat = { n: number; median: number | null };
export type Stats = Record<Kind, Stat> & { total: number };
export type Series = { years: number[] } & Record<Kind, { median: (number | null)[]; n: number[] }>;
export type DepFile = Record<string, Series> & { _meta?: { period?: [string, string] } };

export const parseStats = (json: any): Stats => {
  const r = json?.data?.[0] ?? {};
  const stat = (k: string) => ({ n: r[`nb_ventes_whole_${k}`] ?? 0, median: r[`med_prix_m2_whole_${k}`] ?? null });
  return { appartement: stat('appartement'), maison: stat('maison'), total: r.nb_ventes_whole_apt_maison ?? 0 };
};

const int = (x: number) => x.toLocaleString('fr-FR');
const euros = (x: number) => `${int(x)} €/m²`;
const sales = (n: number) => `${int(n)} vente${n > 1 ? 's' : ''}`;
const month = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "de janvier 2021 à décembre 2025", from the pre-computed file (same release as the live statistics). */
export const periodText = (dep?: DepFile) => {
  const p = dep?._meta?.period;
  return p?.[0] && p[1] ? `de ${month(p[0])} à ${month(p[1])}` : 'sur les cinq dernières années publiées';
};

const LABELS: Record<Kind, string> = { appartement: 'Appartements', maison: 'Maisons' };

const kindFact = (kind: Kind, s: Stat, period: string): Fact =>
  !s.n ? { label: LABELS[kind], value: 'Aucune vente', level: 'info', detail: `Aucune vente retenue ${period}.` }
  : s.n < MIN_SALES || s.median === null ? { label: LABELS[kind], value: 'Trop peu de ventes', level: 'info', detail: `${sales(s.n)} ${period}, pas assez pour un prix médian fiable.` }
  : { label: LABELS[kind], value: euros(s.median), detail: `Prix médian de ${sales(s.n)} ${period}.` };

const yearPart = (label: string, median: number | null, n: number) =>
  median !== null ? `${label} ${euros(median)} (${sales(n)})` : n ? `${label} : ${sales(n)}, trop peu pour une médiane` : `${label} : aucune vente`;

/** One line per year: "2021: appartements 14 535 €/m² (943 ventes), maisons : 4 ventes, trop peu pour une médiane". */
export const yearItems = (s: Series): Item[] =>
  s.years.map((y, i) => ({
    name: String(y),
    detail: [yearPart('appartements', s.appartement.median[i], s.appartement.n[i]), yearPart('maisons', s.maison.median[i], s.maison.n[i])].join(', '),
  }));

export const immoView = ({ insee, arrondissement, stats, dep }: { insee: string; arrondissement: boolean; stats: Stats; dep?: DepFile }): BlockView => {
  const period = periodText(dep);
  const series = dep?.[insee] as Series | undefined;
  const notes = [
    'Une médiane à l’échelle de la commune cache de grands écarts d’une rue à l’autre, et selon l’état, l’étage ou la surface du bien.',
    `Seules les ventes d’un seul logement (avec ses éventuelles dépendances) sont comptées. Nous n’affichons pas de médiane calculée sur moins de ${MIN_SALES} ventes.`,
  ];
  if (!dep) notes.push('L’évolution par année n’est pas disponible pour ce département.');
  else if (!series) notes.push('Aucune vente de maison ou d’appartement n’est retenue dans le détail par année.');
  return {
    facts: [
      kindFact('appartement', stats.appartement, period),
      kindFact('maison', stats.maison, period),
      { label: 'Ventes de logements', value: int(stats.total), detail: `Maisons et appartements, ${period}.` },
    ],
    explanation: 'Prix au mètre carré tiré des ventes enregistrées par l’administration fiscale : la moitié des biens s’est vendue plus cher que le prix médian, l’autre moitié moins cher.',
    ...(series ? { items: yearItems(series) } : {}),
    precision: arrondissement ? 'à l’arrondissement' : 'à la commune',
    source: { name: 'Statistiques DVF (data.gouv.fr, d’après la DGFiP et Etalab)', url: explorerUrl(insee) },
    notes,
  };
};

export const uncoveredView = (): BlockView => ({
  facts: [{ label: 'Prix de l’immobilier', value: 'Non couvert', level: 'unknown', detail: 'Les ventes de ce département ne sont pas publiées dans DVF.' }],
  explanation: 'En Alsace et en Moselle, les ventes sont inscrites au livre foncier, tenu par les tribunaux, et non dans les fichiers de l’administration fiscale d’où vient DVF. Mayotte n’est pas couverte non plus.',
  precision: 'au département',
  source: { name: 'Statistiques DVF (data.gouv.fr, d’après la DGFiP et Etalab)', url: DATASET_URL },
});
