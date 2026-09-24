// Schools around the address, from the "annuaire de l'éducation", and the collège de secteur from
// the "carte scolaire des collèges publics" (data.education.gouv.fr, Explore API v2.1).
// Pure functions only: URL builders and parsers, tested against real answers in tests/fixtures.

import { formatDistance, type BlockView, type Fact, type Item } from './block.ts';

export const DATASET_URL = 'https://data.education.gouv.fr/explore/dataset/fr-en-annuaire-education/';
const API = 'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets';
const RECORDS = `${API}/fr-en-annuaire-education/records`;
export const CARTE_URL = 'https://data.education.gouv.fr/explore/dataset/fr-en-carte-scolaire-colleges-publics/';
// Dataset metadata "modified" (read on 24/09/2026): not worth a request per sheet.
export const CARTE_UPDATED = '02/02/2026';

export type Level = 'ecole' | 'college' | 'lycee';

// The dataset only holds open establishments. `libelle_nature` keeps real schools and drops the
// SEGPA / "section" records counted as collèges or lycées, and the few "écoles sans effectifs".
// Écoles: public and private (the private ones are listed apart). Collèges and lycées: public only,
// the private ones do not depend on the address.
const FILTERS: Record<Level, string> = {
  ecole: "type_etablissement='Ecole' AND libelle_nature LIKE 'ECOLE%' AND libelle_nature!='ECOLE SANS EFFECTIFS PERMANENTS'",
  college: "type_etablissement='Collège' AND libelle_nature LIKE 'COLLEGE%' AND statut_public_prive='Public'",
  lycee: "type_etablissement='Lycée' AND libelle_nature LIKE 'LYCEE%' AND statut_public_prive='Public'",
};

/** Rural addresses are far from collèges (17 km) and lycées (28 km): one wide query, ordered by distance. */
export const RADIUS_KM = 60;

const point = ({ lat, lon }: { lat: number; lon: number }) => `geom'POINT(${lon} ${lat})'`;
const select = (p: { lat: number; lon: number }) =>
  `identifiant_de_l_etablissement,nom_etablissement,statut_public_prive,type_contrat_prive,nom_commune,ecole_maternelle,ecole_elementaire,voie_generale,voie_technologique,voie_professionnelle,date_maj_ligne,distance(position, ${point(p)}) as dist`;

export const nearestUrl = (level: Level, p: { lat: number; lon: number }, limit: number) =>
  `${RECORDS}?${new URLSearchParams({
    select: select(p),
    where: `${FILTERS[level]} AND within_distance(position, ${point(p)}, ${RADIUS_KM}km)`,
    order_by: 'dist',
    limit: String(limit),
  })}`;

/** The collèges named by the carte scolaire (UAI codes), with their distance to the address. */
export const byIdsUrl = (ids: string[], p: { lat: number; lon: number }) =>
  `${RECORDS}?${new URLSearchParams({
    select: select(p),
    where: `identifiant_de_l_etablissement IN (${ids.map((id) => `'${id.replace(/\W/g, '')}'`).join(',')})`,
    order_by: 'dist',
  })}`;

export type School = {
  id: string; name: string; sector: string; public: boolean; town: string; distance: number;
  maternelle?: boolean; elementaire?: boolean; pro?: boolean; gt?: boolean; voies?: string; updated?: string;
};

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
    public: r.statut_public_prive === 'Public',
    town: r.nom_commune,
    distance: r.dist,
    // A "primaire" has both flags set: it counts as a maternelle and as an élémentaire.
    ...(level === 'ecole' ? { maternelle: r.ecole_maternelle === 1, elementaire: r.ecole_elementaire === 1 } : {}),
    ...(level === 'lycee' ? { gt: r.voie_generale === '1' || r.voie_technologique === '1', pro: r.voie_professionnelle === '1' } : {}),
    ...(level === 'lycee' && voies(r) ? { voies: voies(r) } : {}),
    ...(r.date_maj_ligne ? { updated: r.date_maj_ligne } : {}),
  }));

// --- Carte scolaire des collèges publics -------------------------------------------------------

// The carte scolaire writes streets in capitals, without accents or apostrophes, and abbreviates a
// few words ("AVENUE DU MAL DE LATTRE DE TASSIGNY"): both sides are brought to that form.
const ABBR: Record<string, string> = {
  AV: 'AVENUE', BD: 'BOULEVARD', BLD: 'BOULEVARD', PL: 'PLACE', IMP: 'IMPASSE', CHE: 'CHEMIN', CHEM: 'CHEMIN',
  RTE: 'ROUTE', ST: 'SAINT', STE: 'SAINTE', MAL: 'MARECHAL', GAL: 'GENERAL', DR: 'DOCTEUR', PDT: 'PRESIDENT',
};
export const normStreet = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
    .split(' ').map((w) => ABBR[w] ?? w).join(' ');

/**
 * The commune's single-sector row, and the rows of the street. The dataset uses the district codes
 * in Paris, Lyon and Marseille (75107…), as the geocoder does: query with ctx.citycode. The street
 * is matched on its last word server-side, exactly client-side.
 */
export const carteUrl = (citycode: string, street?: string) => {
  const word = street && normStreet(street).split(' ').at(-1);
  const code = citycode.replace(/\W/g, '');
  return `${API}/fr-en-carte-scolaire-colleges-publics/records?${new URLSearchParams({
    select: 'type_et_libelle,n_de_voie_debut,n_de_voie_fin,parite,code_rne,secteur_unique',
    where: `code_insee='${code}' AND (secteur_unique='O'${word ? ` OR type_et_libelle LIKE '%${word}%'` : ''})`,
    // ponytail: 100 rows is plenty for one street (rue Joseph Mougin has 38), paginate if a street ever exceeds it.
    limit: '100',
  })}`;
};

// parite: "P" even numbers, "I" odd, "PI" or empty both. A few malformed rows have no code_rne.
const parityOk = (parite: string | null, n: number) => parite === 'P' ? n % 2 === 0 : parite === 'I' ? n % 2 === 1 : true;

/** UAI codes of the collège(s) of the address, [] when the carte scolaire cannot tell. */
export const matchSecteur = (json: any, { housenumber, street }: { housenumber?: string; street?: string }): string[] => {
  const rows = (json?.results ?? []).filter((r: any) => r.code_rne);
  const uniq = (rs: any[]) => [...new Set<string>(rs.map((r) => r.code_rne))];
  const commune = rows.filter((r: any) => r.secteur_unique === 'O');
  if (commune.length) return uniq(commune);
  if (!street) return [];
  const onStreet = rows.filter((r: any) => r.type_et_libelle && normStreet(r.type_et_libelle) === normStreet(street));
  const n = parseInt(housenumber ?? '', 10);
  if (Number.isNaN(n)) {
    // No number: only answer when the whole street goes to one collège.
    const ids = uniq(onStreet);
    return ids.length === 1 ? ids : [];
  }
  return uniq(onStreet.filter((r: any) =>
    (r.n_de_voie_debut == null || n >= r.n_de_voie_debut) && (r.n_de_voie_fin == null || n <= r.n_de_voie_fin) && parityOk(r.parite, n)));
};

// --- The block --------------------------------------------------------------------------------

/** "2026-09-24" → "24/09/2026". */
export const frDate = (iso: string) => iso.split('-').reverse().join('/');

/** Public schools within this radius are listed (or the nearest few if there are fewer). */
const NEAR_M = 1000;
const MIN_PUBLIC = 5, MAX_PUBLIC = 10, MAX_PRIVATE = 4;

const where = (s: School) => `${s.name} (${s.town})`;
const item = (s: School, what?: string): Item => ({ name: s.name, detail: [what, s.sector, s.voies, s.town].filter(Boolean).join(', '), distance: s.distance });

export type Lists = {
  /** Nearest écoles, public and private, nearest first. */
  ecole: School[];
  /** Nearest public collèges, nearest first (fallback when the sector is unknown). */
  college: School[];
  /** Collège(s) named by the carte scolaire for the address, [] when not found. */
  secteur: School[];
  /** Nearest public lycées, nearest first. */
  lycee: School[];
};

export const schoolsView = ({ ecole, college, secteur, lycee }: Lists): BlockView => {
  const pub = ecole.filter((s) => s.public);
  const near = (s: School) => s.distance <= NEAR_M;
  const nearest = (label: string, s: School | undefined, none: string, extra = ''): Fact => s
    ? { label, value: formatDistance(s.distance), detail: `${where(s)}${extra}.` }
    : { label, value: `${none} à moins de ${RADIUS_KM} km`, level: 'info' };

  const gt = lycee.find((s) => s.gt), pro = lycee.find((s) => s.pro && s !== gt);
  const collegeFact: Fact =
    secteur.length === 1 ? { label: 'Collège de secteur', value: secteur[0].name, detail: `${formatDistance(secteur[0].distance)} (${secteur[0].town}), d’après la carte scolaire.` }
    : secteur.length > 1 ? {
      label: 'Collège de secteur', value: `${secteur.length} collèges possibles`, level: 'warn',
      detail: `La carte scolaire indique ${secteur.length === 2 ? 'deux' : secteur.length} collèges pour cette adresse : ${secteur.map((s) => `${where(s)} ${formatDistance(s.distance)}`).join(' ou ')}. Vérifiez auprès du conseil départemental.`,
    }
    : nearest('Collège public le plus proche (secteur non trouvé)', college[0], 'Aucun collège public', ', car cette adresse n’a pas été trouvée dans la carte scolaire');

  const listed = pub.slice(0, Math.max(MIN_PUBLIC, Math.min(MAX_PUBLIC, pub.filter(near).length)));
  const items: Item[] = [
    ...listed.map((s) => item(s)),
    ...ecole.filter((s) => !s.public && near(s)).slice(0, MAX_PRIVATE).map((s) => item(s)),
    ...(secteur.length ? secteur.map((s) => item(s, 'collège de secteur')) : college.slice(0, 1).map((s) => item(s))),
    ...[gt, pro].filter((s): s is School => !!s).map((s) => item(s)),
  ];
  const updated = [...ecole, ...college, ...secteur, ...lycee].map((s) => s.updated).filter(Boolean).sort().at(-1);
  return {
    facts: [
      nearest('Maternelle publique la plus proche', pub.find((s) => s.maternelle), 'Aucune maternelle publique'),
      nearest('Élémentaire publique la plus proche', pub.find((s) => s.elementaire), 'Aucune élémentaire publique'),
      collegeFact,
      nearest('Lycée public le plus proche', gt, 'Aucun lycée général ou technologique public', gt?.voies ? `, ${gt.voies}` : ''),
    ],
    explanation: 'Le secteur de l’école est fixé par la mairie : renseignez-vous auprès d’elle. Ce site ne peut pas le connaître, il liste donc les écoles publiques proches, puis les écoles privées. Le collège public dépend de la carte scolaire du département et le lycée de l’affectation décidée par l’académie (Affelnet). Les distances sont mesurées à vol d’oiseau.',
    items,
    precision: 'au point (établissements géolocalisés), à l’adresse pour le collège de secteur',
    source: { name: 'Annuaire de l’éducation (ministère de l’Éducation nationale)', url: DATASET_URL, ...(updated ? { updated: frDate(updated) } : {}) },
    notes: [{ text: `Collège de secteur : carte scolaire des collèges publics (DGESCO), mise à jour le ${CARTE_UPDATED}.`, link: { label: 'Voir le jeu de données', url: CARTE_URL } }],
  };
};
