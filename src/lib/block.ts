// Contract shared by every thematic block of the sheet. A block's loader is async and
// independent: it returns a BlockView, or throws (the sheet then shows a clear error).

export type Context = {
  lat: number;
  lon: number;
  label: string;
  /** Geocoder code: the district in Paris, Lyon and Marseille (75107…). */
  citycode: string;
  /** Whole-commune code (75056…), as most commune-level datasets expect. */
  commune: string;
  city: string;
  /** From the geocoder, when the place is an address ("35", "Rue Joseph Mougin"). */
  housenumber?: string;
  street?: string;
};

/** Never rely on colour alone: every level has an icon and a word (see LEVELS). */
export type Level = 'ok' | 'info' | 'warn' | 'alert' | 'unknown';

export type Fact = {
  label: string;
  value: string;
  level?: Level;
  /** One short plain-French sentence under the value. */
  detail?: string;
};

/** `at` lets the sheet's map draw the item as a marker. */
export type Item = { name: string; detail?: string; distance?: number /* metres */; url?: string; at?: { lat: number; lon: number } };

export type BlockView = {
  /** 1 to 3 key facts. */
  facts: Fact[];
  /** One plain-French explanation sentence. */
  explanation: string;
  /** Optional list of nearby things (schools, pharmacies…). */
  items?: Item[];
  /** e.g. "à l’adresse", "à la commune", "réseau d’eau de la commune". */
  precision: string;
  source: { name: string; url: string; updated?: string };
  /** Honest limits worth saying out loud, optionally ending with a link. */
  notes?: Note[];
};

export type Note = string | { text: string; link: { label: string; url: string } };

export type Block = { id: string; title: string; load: (ctx: Context) => Promise<BlockView> };

export const LEVELS: Record<Level, { icon: string; text: string }> = {
  ok: { icon: '✓', text: 'Rien à signaler' },
  info: { icon: 'i', text: 'À savoir' },
  warn: { icon: '!', text: 'Vigilance' },
  alert: { icon: '!!', text: 'Attention' },
  unknown: { icon: '?', text: 'Donnée indisponible' },
};

/** "à moins de 10 m", "à 350 m", "à 1,2 km", "à 17 km". */
export const formatDistance = (m: number) =>
  m < 10 ? 'à moins de 10 m' : m < 1000 ? `à ${Math.round(m / 10) * 10} m` : `à ${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`;

/** Great-circle distance in metres (haversine). */
export const distance = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const rad = Math.PI / 180, R = 6371000;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
