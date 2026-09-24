import { parseFragment, toFragment, type Point } from '../lib/fragment';
import { parsePlaces, precisionOf, communeCode, searchUrl, reverseUrl, type Place } from '../lib/geocode';
import { getJson } from '../lib/http';
import { EXAMPLES } from '../lib/examples';
import { BLOCKS } from '../blocks';
import { mountBlocks } from './render';
import { createMap, type Marker } from './map';
import type { Block, BlockView } from '../lib/block';

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

// Home map: metropolitan France with every example as a clickable marker.
const homeMap = createMap($('home-map'), { zoom: 5, minZoom: 4, maxZoom: 9, label: 'Carte de France avec des adresses d’exemple' });
homeMap.setView({ lat: 46.6, lon: 2.4 }, 5);
homeMap.setMarkers(EXAMPLES.map((e) => ({ ...e, label: `Voir la fiche : ${e.label}`, onClick: () => { location.hash = toFragment(e); } })));

// --- Sheet ---
const sheetMap = createMap($('sheet-map'), { zoom: 16, minZoom: 12, maxZoom: 18, label: 'Carte de situation de l’adresse' });

// Key figures: the first fact of a few blocks, repeated in large type.
const KEYS: { block: string; tone: string }[] = [
  { block: 'air', tone: 'grey' }, { block: 'internet', tone: 'yellow' }, { block: 'immobilier', tone: 'coral' },
];
const keyTile = (tone: string, label: string, value: string, id: string) => {
  const a = Object.assign(document.createElement('a'), { className: `key key-${tone}`, href: `#bloc-${id}` });
  a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(`bloc-${id}`)?.scrollIntoView({ behavior: 'smooth' }); });
  a.append(Object.assign(document.createElement('span'), { className: 'key-label', textContent: label }),
    Object.assign(document.createElement('strong'), { className: 'key-value', textContent: value }));
  return a;
};

// Theme pills: each one shows or hides its block.
const themePills = () => {
  $('theme-pills').replaceChildren(...BLOCKS.map((b) => {
    const pill = Object.assign(document.createElement('button'), { type: 'button', className: 'pill', textContent: b.title });
    pill.setAttribute('aria-pressed', 'true');
    pill.addEventListener('click', () => {
      const on = pill.getAttribute('aria-pressed') !== 'true';
      pill.setAttribute('aria-pressed', String(on));
      const section = document.getElementById(`bloc-${b.id}`);
      if (section) section.hidden = !on;
    });
    return pill;
  }));
  $('themes').hidden = false;
};

const onBlock = (b: Block, v: BlockView | null) => {
  const key = KEYS.find((k) => k.block === b.id);
  const tile = document.getElementById(`key-${b.id}`);
  if (key && tile) {
    const f = v?.facts[0];
    tile.replaceWith(Object.assign(keyTile(key.tone, f ? `${b.title} : ${f.label}` : b.title, f?.value ?? 'Indisponible', b.id), { id: `key-${b.id}` }));
  }
  const pins: Marker[] = (v?.items ?? []).filter((i) => i.at).map((i) => ({ ...i.at!, label: `${b.title} : ${i.name}` }));
  if (pins.length) sheetMap.addMarkers(pins);
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
  $('keys').hidden = $('themes').hidden = true;
  try {
    const place = await placeFor(point);
    if (!place) {
      title.textContent = 'Aucune adresse à cet endroit';
      sheetStatus.textContent = 'Ce point ne correspond à aucune adresse connue en France.';
      return;
    }
    title.textContent = place.label;
    sheetMap.setView(place, 16);
    sheetMap.setMarkers([{ ...place, label: place.label, kind: 'main' }]);
    $('keys').replaceChildren(...KEYS.map((k) => Object.assign(keyTile(k.tone, BLOCKS.find((b) => b.id === k.block)!.title, '…', k.block), { id: `key-${k.block}` })));
    $('keys').hidden = false;
    themePills();
    document.title = `${place.label} · Mon adresse en données`;
    meta.textContent = `Commune : ${place.city} (INSEE ${place.citycode}). Précision de la localisation : ${precisionOf(place.type)}.`;
    mountBlocks($('blocks'), BLOCKS, {
      lat: place.lat, lon: place.lon, label: place.label,
      citycode: place.citycode, commune: communeCode(place.citycode), city: place.city,
      housenumber: place.housenumber, street: place.street,
    }, onBlock);
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
