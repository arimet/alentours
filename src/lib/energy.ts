// Energy performance certificates (DPE, "diagnostic de performance énergétique") of existing
// dwellings, from the ADEME observatory (data-fair dataset dpe03existant, DPE since July 2021 only).
// Pure functions only: URL builders and parsers, tested against real answers in tests/fixtures.

import type { BlockView, Fact, Item, Level } from './block.ts';

const API = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant';
export const DATASET_URL = 'https://data.ademe.fr/datasets/dpe03existant';
export const LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

/** Radius around the geocoded point; the address itself is then matched on street and number. */
export const RADIUS_M = 50;
const SELECT = 'numero_dpe,numero_dpe_remplace,date_etablissement_dpe,etiquette_dpe,etiquette_ges,type_batiment,surface_habitable_logement,surface_habitable_immeuble,identifiant_ban,nom_rue_ban,_geopoint';

/** The dataset's update date: the catalog endpoint honours select (the dataset one sends 90 KB of schema). */
export const metaUrl = () => 'https://data.ademe.fr/data-fair/api/v1/datasets?slug=dpe03existant&select=dataUpdatedAt';
export const parseUpdated = (json: any): string | undefined => json?.results?.[0]?.dataUpdatedAt;

export const nearUrl = ({ lat, lon }: { lat: number; lon: number }) =>
  `${API}/lines?${new URLSearchParams({ geo_distance: `${lon},${lat},${RADIUS_M}m`, select: SELECT, size: '100', sort: '-date_etablissement_dpe' })}`;

// Lucene query string: values are quoted, so quotes and backslashes inside must be escaped.
const q = (s: string) => `"${s.replace(/["\\]/g, '\\$&')}"`;

/**
 * Label counts for the street or the whole place. The dataset uses the district codes in Paris,
 * Lyon and Marseille (code_insee_ban 75107 holds 20 751 DPE, 75056 only 419 misfiled ones):
 * query with ctx.citycode.
 */
export const aggUrl = (citycode: string, street?: string) =>
  `${API}/values_agg?${new URLSearchParams({
    field: 'etiquette_dpe',
    qs: `code_insee_ban:${q(citycode)}${street ? ` AND nom_rue_ban:${q(street)}` : ''}`,
    size: '0',
  })}`;

export type Dpe = {
  id: string; date: string; label: string; ges: string; type: string; surface?: number;
  ban: string; street: string; at?: { lat: number; lon: number };
};

export const parseDpes = (json: any): Dpe[] => {
  const rows = json?.results ?? [];
  // A corrected DPE names the one it replaces: drop the replaced ones.
  const replaced = new Set(rows.map((r: any) => r.numero_dpe_remplace).filter(Boolean));
  return rows.filter((r: any) => !replaced.has(r.numero_dpe) && r.etiquette_dpe).map((r: any) => {
    const [lat, lon] = String(r._geopoint ?? '').split(',').map(Number);
    const surface = r.type_batiment === 'immeuble' ? r.surface_habitable_immeuble : r.surface_habitable_logement;
    return {
      id: r.numero_dpe, date: r.date_etablissement_dpe, label: r.etiquette_dpe, ges: r.etiquette_ges, type: r.type_batiment,
      ...(surface ? { surface } : {}), ban: r.identifiant_ban ?? '', street: r.nom_rue_ban ?? '',
      ...(Number.isFinite(lat) && Number.isFinite(lon) ? { at: { lat, lon } } : {}),
    };
  });
};

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Matching rule for "at the address". The context has no BAN id, so a DPE belongs to the address
 * when, within RADIUS_M of the geocoded point:
 * - its identifiant_ban has a number segment (INSEE_voie_numero[_suffixe]): DPE geocoded only to
 *   the street ("75107_8909") sit on the street's point and are never counted as the address;
 * - that number (and suffix: "00039_ter" is "39 ter") equals the geocoder's housenumber;
 * - its nom_rue_ban equals the geocoder's street (accents and case aside), so the 35 of a
 *   crossing street is not taken.
 * Without a housenumber and a street (a commune, a street), nothing is "at the address".
 */
export const atAddress = (dpes: Dpe[], { housenumber, street }: { housenumber?: string; street?: string }) => {
  if (!housenumber || !street) return [];
  const want = norm(housenumber).replace(/^0+/, '');
  return dpes.filter((d) => {
    const [, , num, ...suffix] = d.ban.split('_');
    return num && norm([num.replace(/^0+/, ''), ...suffix].join(' ')) === want && norm(d.street) === norm(street);
  });
};

export type Counts = { total: number; by: Record<string, number> };
export const parseCounts = (json: any): Counts => ({
  total: json?.total ?? 0,
  by: Object.fromEntries((json?.aggs ?? []).map((a: any) => [a.value, a.total])),
});

// --- The block --------------------------------------------------------------------------------

const frDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const TYPES: Record<string, string> = { immeuble: 'DPE de l’immeuble', appartement: 'DPE d’un appartement', maison: 'DPE d’une maison' };
const typeText = (t: string) => TYPES[t] ?? 'DPE';
const m2 = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} m²`;

// Loi n° 2021-1104 du 22 août 2021 "Climat et résilience", art. 160 (décence énergétique, loi du
// 6 juillet 1989 art. 6): a dwelling cannot be newly rented when labelled G+ (over 450 kWh/m²/an,
// since 1 January 2023), G (1 January 2025), F (1 January 2028), E (1 January 2034).
const RENT: Record<string, string> = {
  G: 'Depuis le 1er janvier 2025, un logement classé G ne peut plus être proposé à la location (loi Climat et résilience).',
  F: 'À partir du 1er janvier 2028, un logement classé F ne pourra plus être proposé à la location (loi Climat et résilience).',
};
export const RENT_NOTE = { text: 'Loi Climat et résilience du 22 août 2021 : un logement ne peut plus être mis en location s’il consomme plus de 450 kWh/m² par an (depuis 2023), s’il est classé G (depuis 2025), F (à partir de 2028) puis E (à partir de 2034).', link: { label: 'Voir sur service-public.fr', url: 'https://www.service-public.fr/particuliers/vosdroits/F2042' } };

const buildingFact = (dpes: Dpe[], hasAddress: boolean): Fact => {
  const label = 'DPE à cette adresse';
  if (!hasAddress) return { label, value: 'Adresse sans numéro', level: 'info', detail: 'Cherchez une adresse avec son numéro pour voir les DPE publiés pour l’immeuble.' };
  if (!dpes.length) return { label, value: 'Aucun DPE publié pour cette adresse', level: 'info', detail: 'Aucun DPE depuis juillet 2021 n’est rattaché à ce numéro dans l’observatoire de l’ADEME.' };
  // The building's own DPE describes it best; otherwise the most recent one (dpes are newest first).
  const d = dpes.find((x) => x.type === 'immeuble') ?? dpes[0];
  const level: Level = RENT[d.label] ? 'warn' : 'info';
  const others = dpes.length > 1 ? ` ${dpes.length} DPE publiés à cette adresse, voir la liste.` : '';
  return {
    label, value: `Étiquette ${d.label} (consommation) / ${d.ges} (émissions)`, level,
    detail: `${typeText(d.type)}, établi le ${frDate(d.date)}.${others}${RENT[d.label] ? ` ${RENT[d.label]}` : ''}`,
  };
};

const pct = (n: number, total: number) => `${Math.round((100 * n) / total)} %`;
const countsFact = (label: string, c: Counts): Fact => c.total
  ? {
    label, value: `${c.total.toLocaleString('fr-FR')} DPE, dont ${pct((c.by.F ?? 0) + (c.by.G ?? 0), c.total)} en F ou G`, level: 'info',
    detail: `${LABELS.map((l) => `${l} : ${(c.by[l] ?? 0).toLocaleString('fr-FR')}`).join(', ')}.`,
  }
  : { label, value: 'Aucun DPE publié', level: 'info' };

export type EnergyInput = {
  near: Dpe[];
  street?: Counts;
  place: Counts;
  ctx: { housenumber?: string; street?: string; city: string; citycode: string; commune: string };
  updated?: string;
};

export const energyView = ({ near, street, place, ctx, updated }: EnergyInput): BlockView => {
  const here = atAddress(near, ctx);
  const district = ctx.citycode !== ctx.commune;
  const facts = [
    buildingFact(here, !!(ctx.housenumber && ctx.street)),
    ...(street && ctx.street ? [countsFact(`Dans la rue (${ctx.street})`, street)] : []),
    countsFact(district ? `Dans l’arrondissement (${ctx.city})` : `Dans la commune (${ctx.city})`, place),
  ];
  const items: Item[] = here.map((d) => ({
    name: `Étiquette ${d.label} / ${d.ges}`,
    detail: [`${typeText(d.type)} du ${frDate(d.date)}`, d.surface && m2(d.surface)].filter(Boolean).join(', '),
    ...(d.at ? { at: d.at } : {}),
  }));
  return {
    facts,
    explanation: 'Le DPE classe un logement de A (très économe) à G (très énergivore) selon sa consommation d’énergie, et de A à G selon ses émissions de gaz à effet de serre. Il est obligatoire pour vendre ou louer. Les chiffres de la rue et de la commune comptent les DPE publiés, pas les logements.',
    items,
    precision: 'adresse (immeuble), rue et commune',
    source: { name: 'ADEME, DPE logements existants (depuis juillet 2021)', url: DATASET_URL, ...(updated ? { updated: frDate(updated) } : {}) },
    notes: [
      'Un DPE décrit un logement ou un immeuble à une date donnée. Les étiquettes de la rue ne sont pas celles de votre logement : demandez le DPE du bien au vendeur ou au bailleur.',
      'Seuls les DPE établis depuis juillet 2021 (nouvelle méthode) figurent dans l’observatoire de l’ADEME. Les DPE plus anciens ne sont pas comptés.',
      'Les répartitions comptent tous les DPE publiés, y compris ceux refaits pour un même logement. Les DPE rattachés à la rue sans numéro ne sont jamais pris pour ceux de l’adresse.',
      RENT_NOTE,
    ],
  };
};
