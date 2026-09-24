// Everyday shops and services around the address, from the files built by scripts/commerces.mjs
// (INSEE, Base permanente des équipements). Pure functions only, tested on real BPE 2025 rows.

import { distance, formatDistance, type BlockView, type Fact, type Item, type Note } from './block.ts';

/** public/data/commerces/<dep>.json: points are [lat, lon, index in types]. */
export type File = { types?: string[]; points?: [number, number, number][]; _meta?: { source: string; vintage: string; url: string } };
type Point = { lat: number; lon: number };

/** Each file also holds the neighbouring departments' points up to this far from its own box. */
export const PAD_KM = 3;
export const RADIUS = 500;

// Type indexes, in the order of TYPES in scripts/commerces.mjs.
const FOOD = [0, 1, 2], POST = 5, BANK = 6;
const PAGE = 'https://www.insee.fr/fr/statistiques/8217525?sommaire=8217537';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const low = (s: string) => s[0].toLowerCase() + s.slice(1);

export const commercesView = (file: File, at: Point): BlockView => {
  const types = file.types ?? [], points = file.points ?? [];
  const source = { name: file._meta?.source ?? 'INSEE, Base permanente des équipements', url: file._meta?.url ?? PAGE };
  const explanation = 'Les distances sont à vol d’oiseau depuis l’adresse. La base est mise à jour une fois par an : une ouverture ou une fermeture récente peut manquer.';
  const precision = 'au point (équipements géolocalisés)';
  if (!points.length)
    return { facts: [{ label: 'Commerces et services', value: 'Donnée indisponible pour ce territoire', level: 'unknown' }], explanation, precision, source };

  // Nearest point of each type, and the count within RADIUS.
  const nearest: { d: number; lat: number; lon: number }[] = [];
  let around = 0;
  for (const [lat, lon, t] of points) {
    const d = distance(at, { lat, lon });
    if (d <= RADIUS) around++;
    if (!nearest[t] || d < nearest[t].d) nearest[t] = { d, lat, lon };
  }
  const found = types.map((_, t) => t).filter((t) => nearest[t]);
  const byDist = (a: number, b: number) => nearest[a].d - nearest[b].d;

  const facts: Fact[] = [];
  const food = FOOD.filter((t) => nearest[t]).sort(byDist);
  facts.push(food.length
    ? {
      label: 'Commerce alimentaire le plus proche',
      value: `${types[food[0]]} ${formatDistance(nearest[food[0]].d)}`,
      ...(food.length > 1 ? { detail: `${cap(food.slice(1).map((t) => `${low(types[t])} ${formatDistance(nearest[t].d)}`).join(', '))}.` } : {}),
    }
    : { label: 'Commerce alimentaire le plus proche', value: 'Aucun trouvé à proximité' });
  facts.push({ label: types[POST], value: nearest[POST] ? cap(formatDistance(nearest[POST].d)) : 'Aucun trouvé à proximité' });
  facts.push({ label: types[BANK], value: nearest[BANK] ? cap(formatDistance(nearest[BANK].d)) : 'Aucune trouvée à proximité' });
  facts.push({ label: `Commerces et services à moins de ${RADIUS} m`, value: around ? String(around) : 'Aucun', detail: 'Tous types de la liste ci-dessous confondus.' });

  const items: Item[] = found.sort(byDist).map((t) => ({ name: types[t], distance: nearest[t].d, at: { lat: nearest[t].lat, lon: nearest[t].lon } }));
  const notes: Note[] = ['Les pharmacies figurent dans le bloc Santé. La base ne recense ni les marchés, ni les bureaux de tabac, ni les distributeurs de billets.'];
  if (found.length < types.length || found.some((t) => nearest[t].d > PAD_KM * 1000))
    notes.push(`Au-delà de ${PAD_KM} km, un équipement situé dans un autre département peut être plus proche que celui indiqué.`);
  return { facts, explanation, items, precision, source, notes };
};
