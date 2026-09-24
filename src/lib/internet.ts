// Fixed internet at the commune, from the files built by scripts/internet.mjs (Arcep open data).
// Pure functions only, tested against real T2 2026 rows in tests/fixtures/internet-*.

import type { BlockView, Context, Fact } from './block.ts';

/** One commune (or arrondissement) of public/data/internet/<dep>.json. See scripts/internet.mjs. */
export type Entry = {
  f?: [number, number];
  n?: number;
  b?: Partial<Record<Tech, number>>;
  d?: [number, number];
  cu?: { s: 'p' | 'f' | 'n'; d?: string };
};
export type File = Record<string, Entry> & { _meta?: { sources: { name: string; url: string; date: string }[]; generated: string } };

type Tech = 'fo' | 'coax' | 'cu' | 'thdr' | '4gf' | 'hdr' | 'sat';
const TECHS: Record<Tech, string> = {
  fo: 'fibre', coax: 'câble', cu: 'cuivre (ADSL, VDSL)', thdr: 'très haut débit radio', '4gf': '4G fixe', hdr: 'haut débit radio', sat: 'satellite',
};
const WHOLE: Record<string, string> = { '75056': 'Paris', '69123': 'Lyon', '13055': 'Marseille' };

export const MAP = 'https://maconnexioninternet.arcep.fr/';
/** Ma connexion internet reads lat, lng, zoom and mode from the URL; buildings show from zoom 17. */
export const mapUrl = ({ lat, lon }: { lat: number; lon: number }) => `${MAP}?lat=${lat}&lng=${lon}&zoom=18&mode=debit`;

const NOTE = 'Ces chiffres portent sur l’ensemble de la commune. Pour savoir si votre logement est raccordable, consultez la carte Arcep à l’adresse.';

const int = (n: number) => n.toLocaleString('fr-FR');
const frDate = (iso: string) => iso.split('-').reverse().join('/');

/** "96 %", but never "0 %" or "100 %" when it is not exactly so. */
export const percent = (x: number, total: number) => {
  const p = Math.round((x / total) * 100);
  return x > 0 && p === 0 ? 'moins de 1 %' : x < total && p === 100 ? 'plus de 99 %' : `${p} %`;
};

const COPPER = {
  p: (d?: string) => ({ value: d ? `Au plus tard le ${frDate(d)}` : 'Prévue', detail: 'Les abonnements ADSL et VDSL par le réseau cuivre s’arrêteront au plus tard à cette date.' }),
  f: () => ({ value: 'Déjà fermé', detail: 'Les abonnements ADSL et VDSL par le réseau cuivre ne sont plus proposés ici.' }),
  n: () => ({ value: 'Pas encore de date', detail: 'Le réseau cuivre (ADSL, VDSL) doit fermer partout en France d’ici 2030.' }),
};

export const internetView = (file: File, ctx: Pick<Context, 'citycode' | 'commune' | 'lat' | 'lon'>): BlockView => {
  const whole = file[ctx.commune];
  // Paris, Lyon, Marseille: fibre and copper by arrondissement, other statistics for the whole city.
  const district = ctx.citycode !== ctx.commune ? file[ctx.citycode] : undefined;
  const local = district ?? whole;
  const sources = file._meta?.sources ?? [];
  const facts: Fact[] = [];

  if (local?.f?.[1]) { // a few "villages morts" of the Meuse have no premises
    const [ftth, total] = local.f;
    facts.push({
      label: district ? 'Fibre dans l’arrondissement' : 'Fibre dans la commune',
      value: `${percent(ftth, total)} des locaux raccordables`,
      level: 'info',
      detail: `${int(ftth)} locaux raccordables sur ${int(total)}, logements et locaux professionnels.`,
    });
  }
  if (whole?.b && whole.n) {
    const n = whole.n;
    const [[top, count], ...others] = (Object.entries(whole.b) as [Tech, number][]).sort((a, b) => b[1] - a[1]);
    const detail = [
      others.length && `Autres : ${others.map(([t, c]) => `${TECHS[t]} ${percent(c, n)}`).join(', ')}.`,
      whole.d && `Sans compter le satellite, ${percent(whole.d[0], n)} des locaux peuvent avoir au moins 30 Mbit/s et ${percent(whole.d[1], n)} au moins 1 Gbit/s.`,
      district && WHOLE[ctx.commune] && `Chiffres pour l’ensemble de ${WHOLE[ctx.commune]}.`,
    ].filter(Boolean).join(' ');
    facts.push({ label: 'Meilleure technologie disponible', value: `${TECHS[top][0].toUpperCase()}${TECHS[top].slice(1)} pour ${percent(count, n)} des locaux`, detail });
  }
  if (local?.cu) facts.push({ label: 'Fermeture du réseau cuivre', ...COPPER[local.cu.s](local.cu.d) });
  if (!facts.length) facts.push({ label: 'Internet fixe', value: 'Donnée indisponible pour cette commune', level: 'unknown' });

  const copperSource = sources.find((s) => s.url.includes('cuivre'));
  const mci = sources.find((s) => s.url.includes('ma-connexion-internet'));
  return {
    facts,
    explanation: 'Un local (logement ou local professionnel) est raccordable à la fibre quand le réseau arrive jusqu’à lui et qu’un opérateur peut y installer une prise. La meilleure technologie d’un local est celle qui lui offre le plus haut débit : fibre, câble, cuivre, box 4G, radio ou satellite.',
    items: [{ name: 'Voir votre adresse sur la carte « Ma connexion internet » de l’Arcep', detail: 'éligibilité de chaque immeuble, opérateur par opérateur', url: mapUrl(ctx) }],
    precision: district ? 'à l’arrondissement pour la fibre et le cuivre, à la commune pour le reste' : 'à la commune',
    source: {
      name: 'Arcep, Cartefibre et Ma connexion internet',
      url: 'https://www.data.gouv.fr/datasets/ma-connexion-internet',
      ...(mci ? { updated: frDate(mci.date) } : {}),
    },
    notes: [NOTE, ...(local?.cu && copperSource ? [`Calendrier de fermeture du cuivre : ${copperSource.name}, mis à jour le ${frDate(copperSource.date)}.`] : [])],
  };
};
