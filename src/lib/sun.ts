// Sun path at the address (pure astronomy, no API) and the orientation of the building's façades,
// live from the BD TOPO buildings of the Géoplateforme (WFS). Pure functions, tested against real responses.
//
// Sun: NOAA Solar Calculator algorithm (Meeus, "Astronomical Algorithms"), as published by the NOAA
// Global Monitoring Laboratory: https://gml.noaa.gov/grad/solcalc/calcdetails.html
// Sunrise and sunset use the standard 90.833° zenith (refraction and the sun's radius).

import type { BlockView, Context, Fact } from './block.ts';

const RAD = Math.PI / 180;
const R = 6371000;

/** Declination (deg) and equation of time (minutes) at a UTC instant (ms). */
const position = (ms: number) => {
  const t = (ms / 86400000 + 2440587.5 - 2451545) / 36525; // Julian centuries since J2000
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = 4 / RAD * (y * Math.sin(2 * l0 * RAD) - 2 * e * Math.sin(m * RAD) + 4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD)
    - 0.5 * y * y * Math.sin(4 * l0 * RAD) - 1.25 * e * e * Math.sin(2 * m * RAD));
  return { decl, eqTime };
};

const H0 = -0.833; // apparent altitude of the sun's upper limb at sunrise/sunset

export type SunDay = { sunrise: Date; sunset: Date; riseAz: number; setAz: number; noonElevation: number };

/** Sun of a calendar day ("2026-06-21") at (lat, lon). ponytail: no polar day/night handling, France only. */
export const sunDay = (lat: number, lon: number, day: string): SunDay => {
  const midnight = Date.parse(`${day}T00:00:00Z`);
  const noonAt = (ms: number) => midnight + (720 - 4 * lon - position(ms).eqTime) * 60000;
  const noon = noonAt(noonAt(midnight + 43200000));
  // Hour angle and azimuth at the horizon, refined once at the event itself (as the NOAA sheet does).
  const event = (sign: 1 | -1) => {
    let ms = noon;
    let az = 0;
    for (let i = 0; i < 2; i++) {
      const { decl, eqTime } = position(ms);
      const cosH = Math.cos((90 - H0) * RAD) / (Math.cos(lat * RAD) * Math.cos(decl * RAD)) - Math.tan(lat * RAD) * Math.tan(decl * RAD);
      const h = Math.acos(cosH) / RAD;
      ms = midnight + (720 - 4 * (lon - sign * h) - eqTime) * 60000;
      const cosA = (Math.sin(decl * RAD) - Math.sin(lat * RAD) * Math.sin(H0 * RAD)) / (Math.cos(lat * RAD) * Math.cos(H0 * RAD));
      az = Math.acos(cosA) / RAD;
    }
    return { at: new Date(ms), az: sign > 0 ? 360 - az : az };
  };
  const rise = event(-1), set = event(1);
  return { sunrise: rise.at, sunset: set.at, riseAz: rise.az, setAz: set.az, noonElevation: 90 - Math.abs(lat - position(noon).decl) };
};

const ZONES: Record<string, string> = {
  '971': 'America/Guadeloupe', '977': 'America/Guadeloupe', '978': 'America/Guadeloupe',
  '972': 'America/Martinique', '973': 'America/Cayenne', '974': 'Indian/Reunion', '976': 'Indian/Mayotte',
};
export const timeZone = (commune: string) => ZONES[commune.slice(0, 3)] ?? 'Europe/Paris';

/** "7 h 05" in the given zone. */
const clock = (d: Date, zone: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: zone, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${Number(p.hour)} h ${p.minute}`;
};
const duration = (ms: number) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
const localDay = (d: Date, zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(d); // YYYY-MM-DD

// Eight compass sectors, north first, with the French article ("au nord", "à l’est").
const DIRS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
const sector = (az: number) => Math.round((((az % 360) + 360) % 360) / 45) % 8;
const vowel = (name: string) => name === 'est' || name === 'ouest';
const toward = (name: string) => (vowel(name) ? `à l’${name}` : `au ${name}`);

// ---- Buildings ----

type Ring = number[][]; // [lon, lat, (z)]
type Feature = { id: string; geometry: { type: string; coordinates: any }; properties: Record<string, any> };
export type Response = { features: Feature[] } | null;

const EPS = 0.0003; // about 33 m by 22 m around the address: enough for the nearest building within 15 m
export const buildingUrl = ({ lat, lon }: { lat: number; lon: number }) => {
  const u = new URL('https://data.geopf.fr/wfs/ows');
  u.search = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: 'BDTOPO_V3:batiment', OUTPUTFORMAT: 'application/json', COUNT: '20',
    BBOX: `${(lat - EPS).toFixed(6)},${(lon - EPS).toFixed(6)},${(lat + EPS).toFixed(6)},${(lon + EPS).toFixed(6)},urn:ogc:def:crs:EPSG::4326`,
  }).toString();
  return u.toString();
};

/** Outer rings of a Polygon or MultiPolygon. */
const rings = (f: Feature): Ring[] => f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map((p: Ring[]) => p[0]) : [];

/** Local metres (x east, y north) around lat0: fine at building scale. */
const metres = (lat0: number, lon0: number) => ([lon, lat]: number[]) => [(lon - lon0) * RAD * R * Math.cos(lat0 * RAD), (lat - lat0) * RAD * R];

const segDist = ([px, py]: number[], [ax, ay]: number[], [bx, by]: number[]) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const inside = ([x, y]: number[], ring: number[][]) => {
  let v = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) v = !v;
  }
  return v;
};
const edges = (ring: number[][]) => ring.slice(1).map((b, i) => [ring[i], b]);

/** The building containing the point, else the nearest one within 15 m. */
export const pickBuilding = (res: Response, at: { lat: number; lon: number }) => {
  const m = metres(at.lat, at.lon);
  let best: { feature: Feature; ring: Ring; d: number } | null = null;
  for (const feature of res?.features ?? []) for (const ring of rings(feature)) {
    const pts = ring.map(m);
    const d = inside([0, 0], pts) ? 0 : Math.min(...edges(pts).map(([a, b]) => segDist([0, 0], a, b)));
    if (d <= 15 && (!best || d < best.d)) best = { feature, ring, d };
  }
  return best;
};

/**
 * Façade directions: each edge's outward normal, weighted by its length, in 8 sectors.
 * Edges lying on another building's outline (party walls, within 1 m) are left out.
 * `main`: sectors of at least 60 % of the largest one (up to 3); `south`: share facing south-east to south-west.
 */
export const facades = (ring: Ring, lat0: number, others: Ring[]) => {
  const p = metres(lat0, ring[0][0]);
  const pts = ring.map(p), near = others.map((o) => o.map(p));
  const area = edges(pts).reduce((s, [[ax, ay], [bx, by]]) => s + ax * by - bx * ay, 0); // > 0: counter-clockwise
  const bins = Array(8).fill(0);
  for (const [a, b] of edges(pts)) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (!len) continue;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (near.some((o) => edges(o).some(([c, d]) => segDist(mid, c, d) < 1))) continue;
    const [nx, ny] = area > 0 ? [dy, -dx] : [-dy, dx];
    bins[sector(Math.atan2(nx, ny) / RAD)] += len;
  }
  const total = bins.reduce((s, x) => s + x, 0) || 1;
  const top = Math.max(...bins);
  const main = bins.map((v, i) => ({ v, i })).filter((b) => b.v && b.v >= 0.6 * top).sort((a, b) => b.v - a.v).map((b) => DIRS[b.i]);
  return { main: main.length > 3 ? [] : main, south: (bins[3] + bins[4] + bins[5]) / total };
};

// ---- Figure ----

const C = 100;
const at = (az: number, r: number) => `${(C + r * Math.sin(az * RAD)).toFixed(1)} ${(C - r * Math.cos(az * RAD)).toFixed(1)}`;
const arc = (d: SunDay, r: number, cls: string, label: string) => {
  const large = (d.setAz - d.riseAz + 360) % 360 > 180 ? 1 : 0;
  const [lx, ly] = at(d.setAz, r + 9).split(' ');
  return `<path class="${cls}" d="M${at(d.riseAz, r)} A${r} ${r} 0 ${large} 1 ${at(d.setAz, r)}"/>`
    + `<path class="${cls}" d="M${at(d.riseAz, r - 12)} L${at(d.riseAz, r)} M${at(d.setAz, r - 12)} L${at(d.setAz, r)}"/>`
    + `<text class="fig-text ${cls}-text" x="${lx}" y="${ly}" text-anchor="middle">${label}</text>`;
};

/** Compass (north up): building outline, sun course on 21 June (orange) and 21 December (teal). Numbers and fixed labels only. */
export const sunFigure = (ring: Ring | null, summer: SunDay, winter: SunDay) => {
  let outline = '';
  if (ring) {
    const mid = (i: number) => (Math.min(...ring.map((q) => q[i])) + Math.max(...ring.map((q) => q[i]))) / 2;
    const lat0 = mid(1), lon0 = mid(0);
    const pts = ring.map(metres(lat0, lon0));
    const k = 42 / Math.max(...pts.map(([x, y]) => Math.hypot(x, y)), 1);
    outline = `<polygon class="fig-building" points="${pts.map(([x, y]) => `${(C + x * k).toFixed(1)},${(C - y * k).toFixed(1)}`).join(' ')}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">`
    + `<circle class="fig-ring" cx="${C}" cy="${C}" r="80"/>`
    + `<text class="fig-text fig-n" x="${C}" y="14" text-anchor="middle">N</text>`
    + `<text class="fig-text fig-s" x="${C}" y="197" text-anchor="middle">S</text>`
    + `<text class="fig-text" x="195" y="${C + 4}" text-anchor="end">E</text>`
    + `<text class="fig-text" x="5" y="${C + 4}">O</text>`
    + `<path class="fig-south" d="M${C - 5} 184 L${C + 5} 184 L${C} 176 Z"/>`
    + outline
    + arc(summer, 72, 'fig-summer', 'juin')
    + arc(winter, 58, 'fig-winter', 'déc.')
    + `</svg>`;
};

// ---- View ----

const fmt = (n: number, d = 0) => n.toLocaleString('fr-FR', { maximumFractionDigits: d });
const course = (d: SunDay) => `Le soleil se lève ${toward(DIRS[sector(d.riseAz)])} et se couche ${toward(DIRS[sector(d.setAz)])}`;
const list = (xs: string[]) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} et ${xs.at(-1)}` : xs[0];
const date = (s: string) => new Date(s).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

export const sunView = (res: Response, ctx: Pick<Context, 'lat' | 'lon' | 'commune'>, now: Date): BlockView => {
  const zone = timeZone(ctx.commune);
  const today = localDay(now, zone), year = today.slice(0, 4);
  const [t, summer, winter] = [today, `${year}-06-21`, `${year}-12-21`].map((d) => sunDay(ctx.lat, ctx.lon, d));
  const times = (d: SunDay) => `lever ${clock(d.sunrise, zone)}, coucher ${clock(d.sunset, zone)}`;
  const length = (d: SunDay) => `${duration(d.sunset.getTime() - d.sunrise.getTime())} de jour`; // starts with a digit: no capital needed

  const picked = pickBuilding(res, ctx);
  let building: Fact;
  if (picked) {
    const others = (res?.features ?? []).filter((f) => f !== picked.feature).flatMap(rings);
    const f = facades(picked.ring, ctx.lat, others);
    const p = picked.feature.properties;
    const about = [
      p.usage_1 && !/^Indiff/.test(p.usage_1) && p.usage_1,
      p.nombre_d_etages > 0 && `${p.nombre_d_etages} étage${p.nombre_d_etages > 1 ? 's' : ''}`,
      p.hauteur > 0 && `${fmt(p.hauteur, 1)} m de haut`,
    ].filter(Boolean).join(', ');
    building = {
      label: 'Orientation du bâtiment',
      value: f.main.length ? `Façades principales vers ${list(f.main.map((d) => (vowel(d) ? `l’${d}` : `le ${d}`)))}` : 'Façades de longueurs proches dans toutes les directions',
      level: 'info',
      detail: [`${fmt(f.south * 100)} % de la longueur des façades regarde vers le sud (du sud-est au sud-ouest).`, about && `${about[0].toUpperCase()}${about.slice(1)}.`].filter(Boolean).join(' '),
    };
  } else building = { label: 'Orientation du bâtiment', value: 'Aucun bâtiment trouvé à l’adresse', level: 'unknown', detail: 'La BD TOPO ne recense pas de bâtiment à moins de 15 m du point de l’adresse.' };

  const bdDate = picked?.feature.properties.date_modification ?? picked?.feature.properties.date_creation;
  return {
    facts: [
      { label: 'Lever et coucher aujourd’hui', value: times(t), level: 'info', detail: `${length(t)}.` },
      { label: 'Été (21 juin)', value: times(summer), level: 'info', detail: `${course(summer)}. ${length(summer)}, ${fmt(summer.noonElevation)}° au-dessus de l’horizon à midi.` },
      { label: 'Hiver (21 décembre)', value: times(winter), level: 'info', detail: `${course(winter)}. ${length(winter)}, ${fmt(winter.noonElevation)}° au-dessus de l’horizon à midi.` },
      building,
    ],
    explanation: 'En France, le soleil de midi est toujours au sud. Une façade tournée vers le sud reçoit donc du soleil une bonne partie de la journée, surtout en hiver quand il reste bas ; une façade au nord n’en reçoit presque pas directement. L’est a le soleil du matin, l’ouest celui de l’après-midi et du soir.',
    figure: sunFigure(picked?.ring ?? null, summer, winter),
    figureLabel: `Boussole, nord en haut${picked ? ', avec le contour du bâtiment' : ''}. En orange, la course du soleil le 21 juin, du ${DIRS[sector(summer.riseAz)]} au ${DIRS[sector(summer.setAz)]} ; en vert, le 21 décembre, du ${DIRS[sector(winter.riseAz)]} au ${DIRS[sector(winter.setAz)]}.`,
    precision: 'à l’adresse (bâtiment le plus proche)',
    source: {
      name: 'Calcul astronomique (algorithme NOAA) et BD TOPO (IGN), via la Géoplateforme',
      url: 'https://geoservices.ign.fr/bdtopo',
      updated: `calcul du ${now.toLocaleDateString('fr-FR', { timeZone: zone })}${bdDate ? `, bâtiment mis à jour le ${date(bdDate)}` : ''}`,
    },
    notes: [
      'Le site ne sait pas où sont les fenêtres du logement ni à quel étage il se trouve.',
      'L’ombre des bâtiments voisins, des arbres et du relief n’est pas prise en compte. En montagne, le relief peut cacher le soleil une bonne partie de la journée.',
      'Les heures sont calculées, pas mesurées : elles supposent un horizon dégagé et plat.',
      'L’orientation vient du contour du bâtiment dans la BD TOPO. Les murs collés à un bâtiment voisin sont écartés quand le voisin est aussi recensé.',
    ],
  };
};
