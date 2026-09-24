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
export type Item = {
  name: string; detail?: string; distance?: number /* metres, as the crow flies */; url?: string; at?: { lat: number; lon: number };
  /** Walking route from the address, when computed (see walk.ts). */
  walk?: { m: number; min: number; line: [number, number][] };
};

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
  /** Small SVG built by our own code only (numbers and fixed labels, never API text), with its text alternative. */
  figure?: string;
  figureLabel?: string;
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

/**
 * One-line status of a block for scanning, derived only from its facts' levels (no score):
 * alerts and warnings are counted; a missing fact makes it "Données incomplètes", never a green light;
 * "Rien à signaler" only when every levelled fact is ok.
 */
export const summarize = (facts: Fact[]): { level: Level; text: string } | null => {
  const n = (l: Level) => facts.filter((f) => f.level === l).length;
  const plural = (k: number, one: string, many: string) => `${k} ${k > 1 ? many : one}`;
  if (n('alert')) return { level: 'alert', text: plural(n('alert'), 'point d’attention', 'points d’attention') };
  if (n('warn')) return { level: 'warn', text: plural(n('warn'), 'point de vigilance', 'points de vigilance') };
  if (n('unknown')) return { level: 'unknown', text: 'Données incomplètes' };
  const levelled = facts.filter((f) => f.level);
  return levelled.length && levelled.every((f) => f.level === 'ok') ? { level: 'ok', text: 'Rien à signaler' } : null;
};
