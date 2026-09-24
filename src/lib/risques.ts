// Géorisques API v1 (no token): URL builders and pure parsers. See docs/feasibility/geo-risques-eau.md, section 2.
// Shapes come from the archived v1 spec 1.12.2 (Wayback 2026-07-17) and archived answers: the API was in 503
// on 2026-09-24, so the tri_zonage and ssp shapes are only checked against the spec, not a live answer.
import { distance, type Context, type Fact, type Item, type Level } from './block.ts';

export const API = 'https://www.georisques.gouv.fr/api/v1';
export const RAYON = 1000; // metres, the API's default radius

const q = (params: Record<string, string | number>) => new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));

export const urls = (ctx: Context) => {
  const latlon = `${ctx.lon},${ctx.lat}`; // Longitude first, despite the name.
  // Radon uses the district code in Paris, Lyon and Marseille; the API takes up to 10 codes, so ask for both.
  const code_insee = [...new Set([ctx.citycode, ctx.commune])].join(',');
  return {
    rga: `${API}/rga?${q({ latlon })}`,
    tri: `${API}/tri_zonage?${q({ latlon })}`,
    sismique: `${API}/zonage_sismique?${q({ code_insee })}`,
    radon: `${API}/radon?${q({ code_insee })}`,
    ssp: `${API}/ssp?${q({ latlon, rayon: RAYON, page_size: 50 })}`,
    icpe: `${API}/installations_classees?${q({ latlon, rayon: RAYON, page_size: 50 })}`,
  };
};

/** Public "risques près de chez moi" report for the address (URL pattern of the Géorisques site, answers 200). */
export const rapportUrl = (ctx: Context) =>
  `https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi/rapport2?${q({
    'form-adresse': 'true', isCadastre: 'false', city: ctx.city, type: 'housenumber', typeForm: 'adresse',
    codeInsee: ctx.citycode, lon: ctx.lon, lat: ctx.lat, adresse: ctx.label,
  })}`;

// Error payloads: paginated models carry response_code + message, others are ExceptionResponseMessage {code, message}.
const check = (json: any) => {
  if (json && (json.response_code >= 400 && json.response_code !== 404 || (json.code && json.message && !('data' in json))))
    throw new Error(json.message || `Géorisques : erreur ${json.response_code}`);
  return json;
};
const rows = (json: any): any[] => check(json)?.data ?? [];

// Clay shrink-swell exposure map (BRGM), classes set by arrêté du 22 juillet 2020 (updated by arrêté du 9 janvier 2026):
// exposition faible / moyenne / forte. In the medium and strong zones, loi ELAN (art. 68, code de la construction
// L132-4 et s.) makes a soil study mandatory to sell a building plot. The map does not cover the city of Paris.
const RGA: Record<string, Level> = { '1': 'info', '2': 'warn', '3': 'alert' };
export const argilesFact = (json: any, ctx: Context): Fact => {
  const { codeExposition: code, exposition } = check(json) ?? {};
  const label = 'Argiles (sol qui gonfle et se rétracte)';
  if (!RGA[code]) return ctx.commune === '75056'
    ? { label, value: 'Non cartographié', level: 'unknown', detail: 'La carte nationale des argiles ne couvre pas la ville de Paris.' }
    : { label, value: 'Pas d’exposition cartographiée', level: 'ok', detail: 'L’adresse est hors des zones d’argiles identifiées par le BRGM.' };
  return {
    label, value: exposition || `Classe ${code}`, level: RGA[code],
    detail: code === '1'
      ? 'Le sol peut bouger un peu en cas de sécheresse, avec un faible risque de fissures.'
      : 'Le sol peut bouger en cas de sécheresse et fissurer les murs. Pour vendre un terrain à bâtir ici, une étude de sol est obligatoire.',
  };
};

// Territoires à risque important d'inondation (directive 2007/60/CE): flood maps for three scenarios
// (forte, moyenne, faible probabilité). Only ~120 territories are mapped, so "outside" is not "no risk".
export const inondationFact = (json: any): Fact => {
  const data = rows(json);
  const label = 'Inondation';
  if (!data.length) return {
    label, value: 'Hors zone inondable cartographiée', level: 'info',
    detail: 'Seuls les grands territoires à risque d’inondation sont cartographiés ici : cela ne veut pas dire qu’il n’y a aucun risque.',
  };
  const list = (f: (r: any) => string | undefined) => [...new Set(data.map(f).filter(Boolean))].join(', ');
  const rivers = list((r) => r.cours_deau), scenarios = list((r) => r.scenario?.libelle);
  return {
    label, value: 'En zone inondable cartographiée', level: 'warn',
    detail: [rivers && `Cours d’eau : ${rivers}.`, scenarios && `Scénarios : ${scenarios}.`].filter(Boolean).join(' '),
  };
};

// Seismic zones: code de l'environnement art. R563-4 (décret 2010-1254): 1 très faible, 2 faible, 3 modérée,
// 4 moyenne, 5 forte. Arrêté du 22 octobre 2010: no rule for ordinary buildings in zone 1; in zone 2 only
// categories III and IV (schools, hospitals…); from zone 3 also category II, which includes houses.
const SISMIQUE: Record<string, [string, Level]> = {
  '1': ['très faible', 'ok'], '2': ['faible', 'info'], '3': ['modérée', 'warn'], '4': ['moyenne', 'alert'], '5': ['forte', 'alert'],
};
const SEISME_REGLES: Partial<Record<Level, string>> = {
  ok: 'Pas de règle parasismique pour les bâtiments courants.',
  info: 'Règles parasismiques pour certains bâtiments neufs (écoles, hôpitaux), pas pour les maisons.',
  warn: 'Les bâtiments neufs, maisons comprises, doivent suivre des règles parasismiques.',
  alert: 'Les bâtiments neufs, maisons comprises, doivent suivre des règles parasismiques.',
};
// Radon potential: arrêté du 27 juin 2018 (code de la santé publique R1333-29): zone 1 faible, zone 2 faible avec
// facteurs géologiques qui facilitent le transfert vers les bâtiments, zone 3 significatif.
const RADON: Record<string, [string, Level]> = { '1': ['faible', 'ok'], '2': ['faible', 'info'], '3': ['significatif', 'warn'] };
const RANK: Level[] = ['unknown', 'ok', 'info', 'warn', 'alert'];

export const communeFact = (sismique: any, radon: any): Fact => {
  const s = SISMIQUE[sismique && rows(sismique)[0]?.code_zone];
  const r = RADON[radon && rows(radon)[0]?.classe_potentiel];
  const levels = [s?.[1], r?.[1]].filter(Boolean) as Level[];
  const detail = [
    s && SEISME_REGLES[s[1]],
    r && (r[1] === 'warn' ? 'Le radon, un gaz naturel, peut s’accumuler dans les logements : aérer et faire mesurer est conseillé.' : undefined),
  ].filter(Boolean).join(' ');
  return {
    label: 'Séisme et radon (commune)',
    value: `Séisme : ${s ? `zone ${rows(sismique)[0].code_zone} (${s[0]})` : 'non disponible'}. Radon : ${r ? `zone ${rows(radon)[0].classe_potentiel} (${r[0]})` : 'non disponible'}.`,
    level: levels.reduce((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a), 'unknown' as Level),
    ...(detail && { detail }),
  };
};

// Every [lon, lat] pair in any GeoJSON object (Point, Polygon, Feature, FeatureCollection…).
const coords = (g: any): number[][] =>
  !g ? [] : typeof g[0] === 'number' ? [g] : Array.isArray(g) ? g.flatMap(coords)
    : [g.coordinates, g.geometry, g.features, g.geometries].flatMap(coords);

// Wording from the v1 spec's own summaries of each dataset.
const SSP_KINDS: [string, string, string][] = [
  ['casias', 'Ancien site industriel ou de service (inventaire CASIAS)', 'nom_etablissement'],
  ['instructions', 'Pollution des sols suivie par l’administration (ex-BASOL)', 'nom_etablissement'],
  ['conclusions_sis', 'Secteur d’information sur les sols (SIS)', 'nom'],
  ['conclusions_sup', 'Servitude d’utilité publique (sols pollués)', 'nom'],
];
export const MAX_ITEMS = 8;

/** Nearby polluted sites and classified installations: Seveso first, then by distance. */
export const sitesItems = (ssp: any, icpe: any, point: { lat: number; lon: number }): { items: Item[]; more: number } => {
  const found: (Item & { seveso: boolean })[] = [];
  if (ssp) for (const [key, detail, nameKey] of SSP_KINDS) for (const s of rows(check(ssp)[key])) {
    // ponytail: distance to the nearest vertex, so a point inside a large polygon reads as "à N m"; add point-in-polygon if it matters.
    const ds = coords(s.geom).map(([lon, lat]) => distance(point, { lat, lon }));
    found.push({
      name: s[nameKey] || s.activite_principale || s.adresse || 'Site sans nom', detail, seveso: false,
      ...(ds.length && { distance: Math.min(...ds) }), ...(s.fiche_risque && { url: s.fiche_risque }),
    });
  }
  for (const i of icpe ? rows(icpe) : []) {
    if (i.regime === 'Non ICPE' || i.longitude == null || i.latitude == null) continue;
    // statutSeveso: "Seveso seuil haut" | "Seveso seuil bas" | "Non Seveso" (spec parameter statutSeveso).
    const seveso = /^Seveso/i.test(i.statutSeveso ?? '');
    const regime = i.regime ? i.regime.toLowerCase() : '';
    found.push({
      name: i.raisonSociale || 'Installation sans nom', seveso,
      detail: seveso ? `Site ${i.statutSeveso}${regime && ` (${regime})`}` : `Installation classée (${[i.statutSeveso, regime].filter(Boolean).join(', ')})`,
      distance: distance(point, { lat: i.latitude, lon: i.longitude }),
      ...(i.codeAIOT && { url: `https://www.georisques.gouv.fr/risques/installations/donnees/details/${i.codeAIOT}` }),
    });
  }
  found.sort((a, b) => +b.seveso - +a.seveso || (a.distance ?? Infinity) - (b.distance ?? Infinity));
  return { items: found.slice(0, MAX_ITEMS).map(({ seveso, ...item }) => item), more: Math.max(0, found.length - MAX_ITEMS) };
};
