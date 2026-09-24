// Everyday shops and services around the address, from the files built by scripts/shops.mjs
// (INSEE, Base permanente des équipements). Pure functions only, tested on real BPE 2025 rows.

import { distance, formatDistance, type BlockView, type Fact, type Item, type Note } from './block.ts';
import { formatWalk, MAX_WALK_M, type Walk } from './walk.ts';

/** public/data/shops/<dep>.json: points are [lat, lon, index in types]. */
export type File = { types?: string[]; points?: [number, number, number][]; _meta?: { source: string; vintage: string; url: string } };
type Point = { lat: number; lon: number };

/** Each file also holds the neighbouring departments' points up to this far from its own box. */
export const PAD_KM = 3;
export const RADIUS = 500;

// Type indexes, in the order of TYPES in scripts/shops.mjs.
const FOOD = [0, 1, 2], POST = 5, BANK = 6;
const PAGE = 'https://www.insee.fr/fr/statistiques/8217525?sommaire=8217537';

/** A place of one type; `walk` is added by the loader (see walk.ts). */
export type Spot = { distance: number; at: Point; walk?: Walk };

/** The `n` nearest places of each type, as the crow flies: the loader routes them on foot. */
export const candidates = (file: File, at: Point, n = 2): Spot[][] => {
  const by: Spot[][] = (file.types ?? []).map(() => []);
  for (const [lat, lon, t] of file.points ?? []) by[t]?.push({ distance: distance(at, { lat, lon }), at: { lat, lon } });
  return by.map((xs) => xs.sort((a, b) => a.distance - b.distance).slice(0, n));
};

/** Walked ones first by walking distance, then the others as the crow flies (as byWalk sorts). */
const cmp = (a: Spot, b: Spot) => (a.walk ? 0 : 1) - (b.walk ? 0 : 1) || (a.walk?.m ?? a.distance) - (b.walk?.m ?? b.distance);
const howFar = (x: Spot) => x.walk ? formatWalk(x.walk) : `${formatDistance(x.distance)} à vol d’oiseau`;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const low = (s: string) => s[0].toLowerCase() + s.slice(1);

export const shopsView = (file: File, at: Point, near: Spot[][] = candidates(file, at)): BlockView => {
  const types = file.types ?? [], points = file.points ?? [];
  const source = { name: file._meta?.source ?? 'INSEE, Base permanente des équipements', url: file._meta?.url ?? PAGE };
  const explanation = `Les distances sont à pied depuis l’adresse, calculées sur le réseau routier de l’IGN, jusqu’à ${MAX_WALK_M / 1000} km. Au-delà, elles sont à vol d’oiseau. La base est mise à jour une fois par an : une ouverture ou une fermeture récente peut manquer.`;
  const precision = 'au point (équipements géolocalisés)';
  if (!points.length)
    return { facts: [{ label: 'Commerces et services', value: 'Donnée indisponible pour ce territoire', level: 'unknown' }], explanation, precision, source };

  // Nearest place of each type (on foot when routed), and the count within RADIUS.
  const nearest = types.map((_, t) => [...(near[t] ?? [])].sort(cmp)[0]);
  const around = points.filter(([lat, lon]) => distance(at, { lat, lon }) <= RADIUS).length;
  const found = types.map((_, t) => t).filter((t) => nearest[t]);
  const byDist = (a: number, b: number) => cmp(nearest[a], nearest[b]);

  const facts: Fact[] = [];
  const food = FOOD.filter((t) => nearest[t]).sort(byDist);
  facts.push(food.length
    ? {
      label: 'Commerce alimentaire le plus proche',
      value: `${types[food[0]]} ${howFar(nearest[food[0]])}`,
      ...(food.length > 1 ? { detail: `${cap(food.slice(1).map((t) => `${low(types[t])} ${howFar(nearest[t])}`).join(' ; '))}.` } : {}),
    }
    : { label: 'Commerce alimentaire le plus proche', value: 'Aucun trouvé à proximité' });
  facts.push({ label: types[POST], value: nearest[POST] ? cap(howFar(nearest[POST])) : 'Aucun trouvé à proximité' });
  facts.push({ label: types[BANK], value: nearest[BANK] ? cap(howFar(nearest[BANK])) : 'Aucune trouvée à proximité' });
  facts.push({ label: `Commerces et services à moins de ${RADIUS} m`, value: around ? String(around) : 'Aucun', detail: 'Tous types de la liste ci-dessous confondus.' });

  const items: Item[] = found.sort(byDist).map((t) => ({ name: types[t], distance: nearest[t].distance, at: nearest[t].at, ...(nearest[t].walk ? { walk: nearest[t].walk } : {}) }));
  const notes: Note[] = ['Les pharmacies figurent dans le bloc Santé. La base ne recense ni les marchés, ni les bureaux de tabac, ni les distributeurs de billets.', 'Distances à pied : calcul d’itinéraire de la Géoplateforme (IGN).'];
  if (found.length < types.length || found.some((t) => nearest[t].distance > PAD_KM * 1000))
    notes.push(`Au-delà de ${PAD_KM} km, un équipement situé dans un autre département peut être plus proche que celui indiqué.`);
  return { facts, explanation, items, precision, source, notes };
};
