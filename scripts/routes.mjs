// Builds src/data/home-routes.json: a few main French road corridors, drawn in orange on the home
// map. Real geometries from the Géoplateforme route service (IGN, car profile, BD TOPO), simplified
// to ~1 km so the file stays small. Run by hand: node scripts/routes.mjs
import { writeFile } from 'node:fs/promises';

const CITIES = {
  Paris: [2.3522, 48.8566], Lille: [3.0573, 50.6292], Lyon: [4.8357, 45.764], Marseille: [5.3698, 43.2965],
  Bordeaux: [-0.5792, 44.8378], Toulouse: [1.4442, 43.6047], Nantes: [-1.5536, 47.2184], Rennes: [-1.6778, 48.1173],
  Strasbourg: [7.7521, 48.5734], Montpellier: [3.8767, 43.6108], Nancy: [6.1844, 48.6921], Clermont: [3.087, 45.7772],
};
const CORRIDORS = [
  ['Paris', 'Lille'], ['Paris', 'Lyon'], ['Lyon', 'Marseille'], ['Paris', 'Bordeaux'], ['Bordeaux', 'Toulouse'],
  ['Toulouse', 'Montpellier'], ['Montpellier', 'Lyon'], ['Paris', 'Nancy'], ['Nancy', 'Strasbourg'],
  ['Paris', 'Rennes'], ['Rennes', 'Nantes'], ['Nantes', 'Bordeaux'], ['Paris', 'Clermont'],
];

/** Douglas-Peucker on [lon, lat] pairs, tolerance in degrees (planar, fine at this scale). */
export const simplify = (pts, tol) => {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts.at(-1)];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-12;
  let max = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > max) { max = d; at = i; }
  }
  return max <= tol ? [a, b] : [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
};

const route = async ([from, to]) => {
  const u = `https://data.geopf.fr/navigation/itineraire?${new URLSearchParams({
    resource: 'bdtopo-osrm', profile: 'car', optimization: 'fastest',
    start: CITIES[from].join(','), end: CITIES[to].join(','), getSteps: 'false', geometryFormat: 'geojson',
  })}`;
  const json = await (await fetch(u)).json();
  const line = simplify(json.geometry.coordinates, 0.01).map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]);
  console.log(`${from} → ${to}: ${Math.round(json.distance / 1000)} km, ${line.length} points`);
  return line;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const lines = [];
  for (const c of CORRIDORS) { lines.push(await route(c)); await new Promise((r) => setTimeout(r, 200)); }
  await writeFile(new URL('../src/data/home-routes.json', import.meta.url), JSON.stringify({
    source: 'Géoplateforme, calcul d’itinéraire (IGN, BD TOPO), profil voiture', lines,
  }));
}
