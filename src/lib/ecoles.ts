// Nearest schools from the "annuaire de l'éducation" (data.education.gouv.fr, Explore API v2.1).
// Pure functions only: URL builders and parsers, tested against real answers in tests/fixtures.

import { formatDistance, type BlockView, type Fact } from './block.ts';

export const DATASET_URL = 'https://data.education.gouv.fr/explore/dataset/fr-en-annuaire-education/';
const RECORDS = 'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records';

export type Level = 'ecole' | 'college' | 'lycee';

// The dataset only holds open establishments. `libelle_nature` keeps real schools and drops the
// SEGPA / "section" records counted as collèges or lycées, and the few "écoles sans effectifs".
// Lycées: general, technological, polyvalent and professional ones alike (a lycée pro is a lycée
// a family may pick after the collège), shown with their "voies" so the reader can tell them apart.
const FILTERS: Record<Level, string> = {
  ecole: "type_etablissement='Ecole' AND libelle_nature LIKE 'ECOLE%' AND libelle_nature!='ECOLE SANS EFFECTIFS PERMANENTS'",
  college: "type_etablissement='Collège' AND libelle_nature LIKE 'COLLEGE%'",
  lycee: "type_etablissement='Lycée' AND libelle_nature LIKE 'LYCEE%'",
};

/** Rural addresses are far from collèges (17 km) and lycées (28 km): one wide query, ordered by distance. */
export const RADIUS_KM = 60;

export const nearestUrl = (level: Level, { lat, lon }: { lat: number; lon: number }, limit: number) => {
  const point = `geom'POINT(${lon} ${lat})'`;
  return `${RECORDS}?${new URLSearchParams({
    select: `identifiant_de_l_etablissement,nom_etablissement,statut_public_prive,type_contrat_prive,code_postal,nom_commune,voie_generale,voie_technologique,voie_professionnelle,date_maj_ligne,distance(position, ${point}) as dist`,
    where: `${FILTERS[level]} AND within_distance(position, ${point}, ${RADIUS_KM}km)`,
    order_by: 'dist',
    limit: String(limit),
  })}`;
};

export type School = { id: string; name: string; sector: string; town: string; distance: number; voies?: string; updated?: string };

const sector = (r: any) =>
  r.statut_public_prive === 'Public' ? 'public'
  : r.type_contrat_prive === 'HORS CONTRAT' ? 'privé hors contrat'
  : /CONTRAT|ASSOC/.test(r.type_contrat_prive ?? '') ? 'privé sous contrat'
  : 'privé';

// The directory abbreviates primary schools: E.P. primaire, E.M. maternelle, E.E. élémentaire,
// then PU/PR (public/privé, already shown as the sector).
const KINDS: Record<string, string> = { P: 'École primaire', M: 'École maternelle', E: 'École élémentaire' };
export const schoolName = (name: string) =>
  name.replace(/^E\.([PME])\.P[UR]\s+/, (_, k) => `${KINDS[k]} `);

const voies = (r: any) => {
  const v = [r.voie_generale === '1' && 'général', r.voie_technologique === '1' && 'technologique', r.voie_professionnelle === '1' && 'professionnel'].filter(Boolean);
  return v.length ? `enseignement ${v.length > 1 ? `${v.slice(0, -1).join(', ')} et ${v.at(-1)}` : v[0]}` : undefined;
};

export const parseSchools = (level: Level, json: any): School[] =>
  (json?.results ?? []).map((r: any) => ({
    id: r.identifiant_de_l_etablissement,
    name: schoolName(r.nom_etablissement),
    sector: sector(r),
    town: r.nom_commune,
    distance: r.dist,
    ...(level === 'lycee' && voies(r) ? { voies: voies(r) } : {}),
    ...(r.date_maj_ligne ? { updated: r.date_maj_ligne } : {}),
  }));

/** "2026-09-24" → "24/09/2026". */
export const frDate = (iso: string) => iso.split('-').reverse().join('/');

const LABELS: Record<Level, string> = { ecole: 'École la plus proche', college: 'Collège le plus proche', lycee: 'Lycée le plus proche' };
const NONE: Record<Level, string> = { ecole: 'Aucune école', college: 'Aucun collège', lycee: 'Aucun lycée' };

/** Assembles the sheet block from the three nearest-first lists. */
export const schoolsView = (lists: Record<Level, School[]>): BlockView => {
  const levels = Object.keys(LABELS) as Level[];
  const facts: Fact[] = levels.map((l) => {
    const s = lists[l][0];
    return s
      ? { label: LABELS[l], value: formatDistance(s.distance), detail: `${s.name} (${s.town}), ${s.sector}${s.voies ? `, ${s.voies}` : ''}.` }
      : { label: LABELS[l], value: `${NONE[l]} à moins de ${RADIUS_KM} km`, level: 'info' };
  });
  const all = levels.flatMap((l) => lists[l]);
  const updated = all.map((s) => s.updated).filter(Boolean).sort().at(-1);
  return {
    facts,
    explanation: 'Les distances sont mesurées à vol d’oiseau. L’établissement le plus proche n’est pas forcément celui où votre enfant sera inscrit : dans le public, l’école dépend du secteur fixé par la commune, le collège de celui fixé par le département et le lycée de l’affectation décidée par l’académie.',
    items: all.map((s) => ({ name: s.name, detail: [s.sector, s.voies, s.town].filter(Boolean).join(', '), distance: s.distance })),
    precision: 'au point (établissements géolocalisés)',
    source: { name: 'Annuaire de l’éducation (ministère de l’Éducation nationale)', url: DATASET_URL, ...(updated ? { updated: frDate(updated) } : {}) },
  };
};
