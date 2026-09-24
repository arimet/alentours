import { distance, formatDistance, type BlockView, type Fact, type Item } from './block.ts';

type Point = { lat: number; lon: number };
export type Urgence = 'generale' | 'pediatrique' | 'smur';
export type Place = Point & { name: string; address: string; distance: number; detail?: string; urgence?: Urgence };

export const FINESS_URL = 'https://www.data.gouv.fr/fr/datasets/referentiel-finess-t-finess/';
export const AMELI_URL = 'https://www.data.gouv.fr/fr/datasets/annuaire-sante-de-la-cnam/';
const FINESS_API = 'https://tabular-api.data.gouv.fr/api/resources/796dfff7-cf54-493a-a0a7-ba3c2024c6f3/data/';
const ODS = 'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/annuaire-des-professionnels-de-sante';
export const AMELI_META_URL = ODS;

/** Bounding-box half-sizes (km): first try, then one wider try if empty (rural areas). */
export const RADII = { pharmacie: [1.5, 15], urgences: [15, 60] } as const;
export type FinessKind = keyof typeof RADII;

// ponytail: 200 rows per bbox, no paging; the radii keep dense Paris well under it.
export const finessUrl = (kind: FinessKind, p: Point, km: number) => {
  const dLat = km / 111.32, dLon = km / (111.32 * Math.cos((p.lat * Math.PI) / 180));
  const q = new URLSearchParams({
    etat__exact: 'ACTUEL',
    type__exact: 'ET',
    ...(kind === 'pharmacie' ? { categ_code__exact: '620' } : { san_urg__exact: 'true' }),
    geoloc_4326_lat__greater: (p.lat - dLat).toFixed(5),
    geoloc_4326_lat__less: (p.lat + dLat).toFixed(5),
    geoloc_4326_long__greater: (p.lon - dLon).toFixed(5),
    geoloc_4326_long__less: (p.lon + dLon).toFixed(5),
    columns: 'rs,adresse_num_voie,adresse_type_voie,adresse_nom_voie,adresse_lib_routage,san_med,geoloc_4326_lat,geoloc_4326_long,date_extract_finess',
    page_size: '200',
  });
  return `${FINESS_API}?${q}`;
};

export const gpUrl = (p: Point) => {
  const pt = `geom'POINT(${p.lon} ${p.lat})'`;
  const q = new URLSearchParams({
    select: `nom,adresse,convention,coordonnees,distance(coordonnees, ${pt}) as dist`,
    where: `libelle_profession='Médecin généraliste' AND within_distance(coordonnees, ${pt}, 50km)`,
    order_by: 'dist',
    limit: '100',
  });
  return `${ODS}/records?${q}`;
};

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const ACRONYMS = /^(GH|GHU|GHT|CH|CHU|CHR|CHRU|CHI|CHIC|APHP|APHM|HCL|CUP|SUN|NUP|GCS|SMUR|SAMU|SELAS|SELARL|SARL|EURL|SNC)$/;
/** "PHARMACIE DE SAXE" → "Pharmacie De Saxe", keeping hospital acronyms (CH, GHU…) upper-case. */
const title = (s: string) => s.split(' ').map((w) => ACRONYMS.test(w.toUpperCase()) ? w.toUpperCase()
  : w.toLowerCase().replace(/(^|['’(-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())).join(' ');

export const byDistance = <T extends { distance: number }>(xs: T[]) => [...xs].sort((a, b) => a.distance - b.distance);

/** FINESS rows, sorted by distance. `urgence` says what kind of emergency site it is, from its name. */
export const parseFiness = (json: any, from: Point): Place[] => byDistance((json?.data ?? [])
  .filter((r: any) => Number.isFinite(r.geoloc_4326_lat) && Number.isFinite(r.geoloc_4326_long))
  .map((r: any) => {
    const at = { lat: r.geoloc_4326_lat, lon: r.geoloc_4326_long };
    return {
      ...at,
      name: title(clean(r.rs)),
      address: title(clean([r.adresse_num_voie, r.adresse_type_voie, r.adresse_nom_voie].join(' ')) + (r.adresse_lib_routage ? `, ${clean(r.adresse_lib_routage)}` : '')),
      distance: distance(from, at),
      urgence: urgenceKind(r),
    };
  }));

/**
 * FINESS has no field telling apart adult ERs, SMUR bases and paediatric ERs: `san_urg` is
 * true for all three. SMUR antennas carry "SMUR"/"SAMU" in their name, or have no medicine
 * activity (`san_med`) and "ANTENNE" in their name; paediatric sites are spotted by name.
 */
export const urgenceKind = (r: { rs?: string; san_med?: boolean }): Urgence => {
  const n = clean(r.rs).toUpperCase();
  if (/SMUR|SAMU/.test(n) || (r.san_med === false && /ANTENNE/.test(n))) return 'smur';
  if (/ENFANT|PEDIATRI|PÉDIATRI|ROBERT DEBRE|APHP SUN SITE TROUSSEAU|LENVAL/.test(n)) return 'pediatrique';
  return 'generale';
};

/** The Ameli directory has one row per opening slot: keep one per (name, address). */
export const parseGps = (json: any, from: Point): Place[] => {
  const seen = new Map<string, Place>();
  for (const r of json?.results ?? []) {
    const c = r.coordonnees;
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    const name = title(clean(r.nom)), address = title(clean(r.adresse));
    const key = `${name}|${address}`;
    if (seen.has(key)) continue;
    seen.set(key, { lat: c.lat, lon: c.lon, name: `Dr ${name}`, address, distance: distance(from, c), detail: clean(r.convention).split(',')[0] || undefined });
  }
  return byDistance([...seen.values()]);
};

/** Small bbox first, one wider bbox if it is empty. Returns the places and the raw answer (for its date). */
export const nearbyFiness = async (kind: FinessKind, p: Point, get: (url: string) => Promise<any>) => {
  let json: any, places: Place[] = [];
  for (const km of RADII[kind]) {
    json = await get(finessUrl(kind, p, km));
    places = parseFiness(json, p);
    if (places.length) break;
  }
  return { places, date: finessDate(json) };
};

export const finessDate = (json: any): string | undefined => json?.data?.find((r: any) => r.date_extract_finess)?.date_extract_finess;

export const toItem = (p: Place, kind: string): Item => ({ name: p.name, detail: [kind, p.address].filter(Boolean).join(', '), distance: p.distance });

/** "2026-05-04" or an ISO timestamp → "04/05/2026". */
export const frDate = (iso?: string) => iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : undefined;

/** What load() gathered; `undefined` means that source failed. */
export type SanteData = { pharmacies?: Place[]; gps?: Place[]; urgences?: Place[]; finessDate?: string; ameliDate?: string };

const nearestFact = (label: string, places: Place[] | undefined, noneWithin: string): Fact => {
  if (!places) return { label, value: 'Donnée indisponible', level: 'unknown', detail: 'La source n’a pas répondu.' };
  const p = places[0];
  if (!p) return { label, value: noneWithin, level: 'info' };
  return { label, value: formatDistance(p.distance), detail: `${p.name}, ${p.address}.` };
};

export const santeView = (d: SanteData): BlockView => {
  const general = d.urgences?.filter((u) => u.urgence === 'generale');
  const urgItems = (d.urgences ?? []).filter((u) => u.urgence !== 'smur').slice(0, 3)
    .map((u) => toItem(u, u.urgence === 'pediatrique' ? 'Urgences pédiatriques' : 'Urgences'));
  const finess = frDate(d.finessDate), ameli = frDate(d.ameliDate);
  const notes = [
    `Pharmacies et urgences : répertoire FINESS, extraction du ${finess ?? 'date inconnue'}.`,
    `Médecins généralistes : copie de l’annuaire santé de l’Assurance Maladie publiée par Opendatasoft (un tiers, pas l’Assurance Maladie), copie du ${ameli ?? 'date inconnue'}. Annuaire officiel : ${AMELI_URL}`,
    'FINESS ne distingue pas les urgences adultes, les urgences pédiatriques et les antennes SMUR (équipes mobiles, sans accueil du public). Le tri se fait sur le nom de l’établissement et peut se tromper.',
  ];
  if (!d.pharmacies || !d.urgences) notes.push('Le répertoire FINESS n’a pas répondu en partie : les pharmacies ou les urgences peuvent manquer.');
  if (!d.gps) notes.push('L’annuaire des médecins n’a pas répondu : les généralistes manquent.');
  return {
    facts: [
      nearestFact('Pharmacie la plus proche', d.pharmacies, `Aucune à moins de ${RADII.pharmacie[1]} km`),
      nearestFact('Médecin généraliste le plus proche', d.gps, 'Aucun à moins de 50 km'),
      nearestFact('Service d’urgences le plus proche', general, `Aucun à moins de ${RADII.urgences[1]} km`),
    ],
    explanation: 'Les distances sont à vol d’oiseau, pas par la route. La liste ne dit pas si un médecin accepte de nouveaux patients.',
    items: [
      ...(d.pharmacies ?? []).slice(0, 3).map((p) => toItem(p, 'Pharmacie')),
      ...(d.gps ?? []).slice(0, 3).map((p) => toItem(p, ['Médecin généraliste', p.detail].filter(Boolean).join(', '))),
      ...urgItems,
    ],
    precision: 'au point',
    source: { name: 'FINESS, data.gouv.fr', url: FINESS_URL, updated: finess },
    notes,
  };
};
