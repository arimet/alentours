// Tap water quality from Hub'Eau (contrôle sanitaire of the ARS). Pure URL builders and parsers.
import type { BlockView, Fact, Item, Level } from './block';

const BASE = 'https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable';

export const PARAMS = {
  /** Escherichia coli: analysed in nearly every sample (441 of 447 in Paris, 2026), so it lists the samples. */
  ecoli: '1449',
  nitrates: '1340',
  /** Somme de 20 PFAS. */
  pfas: '8847',
  /** Total des pesticides. */
  pesticides: '6276',
};

const FIELDS = [
  'code_prelevement', 'date_prelevement', 'code_parametre', 'resultat_alphanumerique', 'resultat_numerique',
  'libelle_unite', 'limite_qualite_parametre', 'conclusion_conformite_prelevement',
  'conformite_limites_bact_prelevement', 'conformite_limites_pc_prelevement', 'reseaux',
].join(',');

/** The 20 latest results of one parameter since January of last year (a few kB). */
export const resultsUrl = (commune: string, code: string, year: number) =>
  `${BASE}/resultats_dis?${new URLSearchParams({
    code_commune: commune, code_parametre: code, date_min_prelevement: `${year - 1}-01-01`,
    sort: 'desc', size: '20', fields: FIELDS,
  })}`;

/** Networks (UDI) serving the commune this year and last year (the current year may not be published yet). */
export const udiUrl = (commune: string, year: number) =>
  `${BASE}/communes_udi?${new URLSearchParams({
    code_commune: commune, annee: `${year},${year - 1}`, fields: 'code_reseau,nom_reseau,nom_quartier,annee', size: '100',
  })}`;

export type Row = {
  code_prelevement: string;
  date_prelevement: string;
  resultat_alphanumerique?: string;
  resultat_numerique?: number | null;
  libelle_unite?: string | null;
  limite_qualite_parametre?: string | null;
  conclusion_conformite_prelevement?: string | null;
  conformite_limites_bact_prelevement?: string | null;
  conformite_limites_pc_prelevement?: string | null;
  reseaux?: { code: string; nom: string }[] | null;
};

export type Network = { code: string; name: string; quartier?: string };

export const networks = (json: any): Network[] => {
  const rows: any[] = json?.data ?? [];
  const year = rows.reduce((max, r) => (r.annee > max ? r.annee : max), '');
  const seen = new Map<string, Network>();
  for (const r of rows)
    if (r.annee === year && !seen.has(r.code_reseau))
      seen.set(r.code_reseau, { code: r.code_reseau, name: r.nom_reseau, quartier: r.nom_quartier && r.nom_quartier !== '-' ? r.nom_quartier : undefined });
  return [...seen.values()];
};

export type Sample = { code: string; date: string; network: string; rows: Row[] };

/** One row is one parameter: group rows by sample, then keep the latest sample of each network. */
export const latestPerNetwork = (rows: Row[]): Sample[] => {
  const samples = new Map<string, Sample>();
  for (const r of rows) {
    const s = samples.get(r.code_prelevement);
    if (s) s.rows.push(r);
    else samples.set(r.code_prelevement, {
      code: r.code_prelevement, date: r.date_prelevement,
      network: (r.reseaux ?? []).map((n) => n.nom).join(', '), rows: [r],
    });
  }
  const latest = new Map<string, Sample>();
  for (const s of samples.values()) {
    const cur = latest.get(s.network);
    if (!cur || s.date > cur.date) latest.set(s.network, s);
  }
  return [...latest.values()].sort((a, b) => b.date.localeCompare(a.date));
};

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

const on = (s: Sample, several: boolean) => `Prélèvement du ${formatDate(s.date)}${several && s.network ? `, réseau ${s.network}` : ''}`;

/** Conformity of the latest sample of each network; the worst one is shown. */
export const conformityFact = (rows: Row[]): Fact => {
  const label = 'Conformité du dernier prélèvement';
  const samples = latestPerNetwork(rows);
  if (!samples.length) return { label, value: 'Pas de prélèvement récent', level: 'unknown', detail: 'Aucun résultat publié depuis le début de l’année dernière.' };
  const several = samples.length > 1;
  const bact = samples.find((s) => s.rows[0].conformite_limites_bact_prelevement === 'N');
  const pc = samples.find((s) => s.rows[0].conformite_limites_pc_prelevement === 'N');
  // A bacteriological breach can make people ill quickly (boil-water advice); a physico-chemical one is usually a long-term concern.
  if (bact) return { label, value: 'Non conforme', level: 'alert', detail: `${on(bact, several)} : limites bactériologiques dépassées.` };
  if (pc) return { label, value: 'Non conforme', level: 'warn', detail: `${on(pc, several)} : limites physico-chimiques dépassées.` };
  // Without the two flags, fall back on the ARS's own conclusion text.
  const other = samples.find((s) => !s.rows[0].conformite_limites_bact_prelevement && !s.rows[0].conformite_limites_pc_prelevement
    && /non[- ]conforme/i.test(s.rows[0].conclusion_conformite_prelevement ?? ''));
  if (other) return { label, value: 'Non conforme', level: 'warn', detail: `${on(other, several)} : ${other.rows[0].conclusion_conformite_prelevement}` };
  return { label, value: 'Conforme', level: 'ok', detail: `${on(samples[0], several)}${several ? ' (le plus récent)' : ''} : limites de qualité respectées.` };
};

/** "<=0,1 µg/L" → 0.1 */
const limitOf = (text?: string | null) => {
  const m = text?.match(/([\d,.]+)/);
  return m ? Number(m[1].replace(',', '.')) : undefined;
};

/**
 * Latest value of one parameter. With several networks we show the worst latest value (no address → network link
 * exists, so the reader must assume the least good one). The limit comes from `limite_qualite_parametre` in the API
 * answer: it is the regulatory limit of the arrêté du 11 janvier 2007 (annexe I), not a threshold of ours.
 */
export const measureFact = (label: string, rows: Row[]): Fact => {
  const samples = latestPerNetwork(rows);
  if (!samples.length) return { label, value: 'Pas de mesure récente', level: 'unknown', detail: 'Aucune mesure publiée depuis le début de l’année dernière.' };
  const pick = samples.reduce((w, s) => ((s.rows[0].resultat_numerique ?? 0) > (w.rows[0].resultat_numerique ?? 0) ? s : w));
  const r = pick.rows[0];
  // Below the detection limit, resultat_numerique is 0: show "<0,029", never "0".
  // Some labs send "<SEUIL" without the threshold itself.
  const value = r.resultat_alphanumerique === '<SEUIL'
    ? 'Sous le seuil de détection du laboratoire'
    : [r.resultat_alphanumerique, r.libelle_unite].filter(Boolean).join(' ');
  const limit = limitOf(r.limite_qualite_parametre);
  const when = on(pick, samples.length > 1);
  if (limit === undefined) return { label, value, level: 'info', detail: `${when}. Pas de limite réglementaire indiquée.` };
  const limitText = `${limit.toLocaleString('fr-FR')} ${r.libelle_unite ?? ''}`.trim();
  const over = (r.resultat_numerique ?? 0) > limit;
  return { label, value, level: over ? 'warn' : 'ok', detail: `${when}. Limite réglementaire : ${limitText}${over ? ', dépassée' : ''}.` };
};

export type Answers = { udi: any; conformite: any; nitrates: any; pfas: any; pesticides: any };

/** Each answer is the Hub'Eau JSON, or null when that call failed. */
export const buildView = (a: Answers): BlockView => {
  const rows = (j: any): Row[] => j?.data ?? [];
  const nets = networks(a.udi);
  const facts = [
    conformityFact([...rows(a.conformite), ...rows(a.nitrates), ...rows(a.pfas), ...rows(a.pesticides)]),
    measureFact('Nitrates', rows(a.nitrates)),
    measureFact('PFAS (somme de 20)', rows(a.pfas)),
  ];
  const failed = ([['conformité', a.conformite], ['nitrates', a.nitrates], ['PFAS', a.pfas], ['pesticides', a.pesticides], ['réseaux', a.udi]] as const)
    .filter(([, j]) => j === null).map(([n]) => n);
  for (const [i, name] of [[0, 'conformité'], [1, 'nitrates'], [2, 'PFAS']] as const)
    if (failed.includes(name)) facts[i] = { ...facts[i], value: 'Donnée indisponible', level: 'unknown' as Level, detail: 'Le service n’a pas répondu.' };

  const items: Item[] = [];
  if (a.pesticides) {
    const p = measureFact('Total des pesticides', rows(a.pesticides));
    items.push({ name: 'Total des pesticides', detail: `${p.value}. ${p.detail}` });
  }
  if (nets.length > 1) for (const n of nets) items.push({ name: `Réseau ${n.name}`, detail: n.quartier });

  const notes = ['Les résultats sont publiés avec 2 à 5 mois de retard sur la date du prélèvement.'];
  if (nets.length > 1)
    notes.push(`La commune est desservie par ${nets.length} réseaux d’eau. Faute de lien entre l’adresse et le réseau, chaque valeur affichée est la moins bonne des derniers prélèvements de chaque réseau.`);
  if (failed.length) notes.push(`Donnée indisponible pour l’instant : ${failed.join(', ')}.`);

  const dates = [a.conformite, a.nitrates, a.pfas, a.pesticides].flatMap(rows).map((r) => r.date_prelevement).sort();
  const last = dates.at(-1);
  return {
    facts,
    explanation: 'L’agence régionale de santé analyse régulièrement l’eau du robinet et la compare aux limites de qualité fixées par la réglementation.',
    items,
    precision: 'réseau d’eau de la commune, pas l’adresse exacte',
    source: {
      name: 'Hub’Eau, contrôle sanitaire (ministère de la Santé, ARS)',
      // orobnat.sante.gouv.fr only shows a commune after a form POST (a GET with the commune gives HTTP 500),
      // and eaupotable.sante.gouv.fr sits behind a bot check: the data.gouv dataset page is the stable public link.
      url: 'https://www.data.gouv.fr/datasets/resultats-du-controle-sanitaire-de-leau-distribuee-commune-par-commune/',
      updated: last && formatDate(last),
    },
    notes,
  };
};
