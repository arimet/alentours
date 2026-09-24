import { parseFragment, toFragment, type Point } from '../lib/fragment';
import { parsePlaces, precisionOf, communeCode, searchUrl, reverseUrl, type Place } from '../lib/geocode';
import { getJson } from '../lib/http';
import { EXAMPLES } from '../lib/examples';
import { BLOCKS } from '../blocks';
import { mountBlocks } from './render';
import { tileOf, tileUrl } from '../lib/tiles';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const search = $('search'), sheet = $('sheet');
const input = $<HTMLInputElement>('q'), list = $<HTMLUListElement>('suggestions'), status = $('q-status');

// --- Search: combobox with debounced autocomplete ---
let places: Place[] = [];
let active = -1;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastQuery = '';

const close = () => {
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  active = -1;
};

const renderList = () => {
  list.replaceChildren(...places.map((p, i) => {
    const li = document.createElement('li');
    li.id = `opt-${i}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === active));
    li.textContent = p.label;
    li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(p); });
    return li;
  }));
  list.hidden = places.length === 0;
  input.setAttribute('aria-expanded', String(!list.hidden));
  if (active >= 0) input.setAttribute('aria-activedescendant', `opt-${active}`);
  else input.removeAttribute('aria-activedescendant');
};

const suggest = async (q: string) => {
  lastQuery = q;
  try {
    const found = parsePlaces(await getJson(searchUrl(q), { timeout: 5000 }));
    if (q !== lastQuery) return; // a newer keystroke won
    places = found;
    active = -1;
    renderList();
    status.textContent = found.length ? '' : 'Aucune adresse trouvée. Vérifiez l’orthographe ou ajoutez la ville.';
  } catch {
    if (q === lastQuery) status.textContent = 'Le service d’adresses ne répond pas. Réessayez dans un instant.';
  }
};

input.addEventListener('input', () => {
  clearTimeout(timer);
  const q = input.value.trim();
  status.textContent = '';
  if (q.length < 3) { places = []; close(); return; }
  timer = setTimeout(() => suggest(q), 250);
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!places.length) return;
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + places.length) % places.length;
    renderList();
  } else if (e.key === 'Escape') {
    close();
  }
});
input.addEventListener('blur', close);

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = places[active] ?? places[0];
  if (p) choose(p);
  else status.textContent = input.value.trim().length < 3 ? 'Tapez au moins 3 caractères.' : 'Choisissez une adresse dans la liste.';
});

const choose = (p: Place) => {
  close();
  const fragment = toFragment(p);
  // Keep what the visitor picked, so the sheet shows it rather than a reverse-geocoded neighbour.
  try { sessionStorage.setItem(`place:${fragment}`, JSON.stringify(p)); } catch {}
  location.hash = fragment;
};

// One example, drawn uniformly at random.
const example = EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)];
const exampleBtn = $<HTMLButtonElement>('example');
exampleBtn.textContent = example.label;
exampleBtn.addEventListener('click', () => { location.hash = toFragment(example); });

// --- Sheet ---
// Situation map: 5×3 Plan IGN tiles (wide enough for the 60rem column) at zoom 16, shifted so the address sits in the centre.
const ZOOM = 16;
const showMap = (point: Point) => {
  const { x, y, px, py } = tileOf(point, ZOOM);
  const tiles = $('map-tiles');
  tiles.replaceChildren();
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const img = Object.assign(document.createElement('img'), { src: tileUrl(ZOOM, x + dx, y + dy), alt: '', width: 256, height: 256, loading: 'lazy' });
      img.style.left = `calc(50% + ${(dx * 256 - px).toFixed(1)}px)`;
      img.style.top = `calc(50% + ${(dy * 256 - py).toFixed(1)}px)`;
      tiles.append(img);
    }
  tiles.append(Object.assign(document.createElement('span'), { className: 'marker' }));
  $('map').hidden = false;
};

const placeFor = async (point: Point): Promise<Place | undefined> => {
  try {
    const stored = sessionStorage.getItem(`place:${toFragment(point)}`);
    if (stored) return JSON.parse(stored);
  } catch {}
  return parsePlaces(await getJson(reverseUrl(point)))[0];
};

const showSheet = async (point: Point) => {
  search.hidden = true;
  sheet.hidden = false;
  const title = $('sheet-title'), meta = $('sheet-meta'), sheetStatus = $('sheet-status');
  title.textContent = 'Recherche de l’adresse…';
  meta.textContent = sheetStatus.textContent = '';
  $('blocks').replaceChildren();
  $('map').hidden = true;
  try {
    const place = await placeFor(point);
    if (!place) {
      title.textContent = 'Aucune adresse à cet endroit';
      sheetStatus.textContent = 'Ce point ne correspond à aucune adresse connue en France.';
      return;
    }
    title.textContent = place.label;
    showMap(place);
    document.title = `${place.label} · Mon adresse en données`;
    meta.textContent = `Commune : ${place.city} (INSEE ${place.citycode}). Précision de la localisation : ${precisionOf(place.type)}.`;
    mountBlocks($('blocks'), BLOCKS, {
      lat: place.lat, lon: place.lon, label: place.label,
      citycode: place.citycode, commune: communeCode(place.citycode), city: place.city,
      housenumber: place.housenumber, street: place.street,
    });
  } catch {
    title.textContent = 'Adresse indisponible';
    sheetStatus.textContent = 'Le service d’adresses ne répond pas. Rechargez la page dans un instant.';
  }
  title.focus();
};

const route = () => {
  const point = parseFragment(location.hash);
  if (point) return showSheet(point);
  sheet.hidden = true;
  search.hidden = false;
  document.title = 'Mon adresse en données';
  if (location.hash.length > 1) status.textContent = 'Ce lien ne contient pas de coordonnées valides.';
};
addEventListener('hashchange', route);
route();
