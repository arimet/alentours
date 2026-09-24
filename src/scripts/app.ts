import { parseFragment, toFragment, type Point } from '../lib/fragment';
import { parsePlaces, precisionOf, communeCode, searchUrl, reverseUrl, type Place } from '../lib/geocode';
import { getJson } from '../lib/http';
import { EXAMPLES } from '../lib/examples';
import { BLOCKS } from '../blocks';
import { mountBlocks } from './render';
import { createMap } from './map';
import { formatWalk } from '../lib/walk';
import { formatDistance } from '../lib/block';
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
// On wide screens a white side panel covers the left of the map: keep the subject to its right.
const focusX = () => (innerWidth > 896 ? 0.64 : 0.5);
const homeMap = createMap($('home-map'), { zoom: 5, minZoom: 4, maxZoom: 9, label: 'Carte de France avec des adresses d’exemple', focusX });
homeMap.setView({ lat: 46.6, lon: 2.4 }, 6);
homeMap.setMarkers(EXAMPLES.map((e) => ({ ...e, label: `Voir la fiche : ${e.label}`, focusable: true, onClick: () => { location.hash = toFragment(e); } })));

// --- Sheet ---
const sheetMap = createMap($('sheet-map'), { zoom: 16, minZoom: 12, maxZoom: 18, label: 'Carte de situation de l’adresse', focusX });
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
};
const two = (i: number) => String(i + 1).padStart(2, '0');

let here: Place | undefined;
let views = new Map<string, BlockView | null>();
let activeTheme = 'ecoles';
let selected = 0;
let picked = false;
const PREFERRED = ['ecoles', 'sante', 'commerces'];

const mapItems = (id: string) => (views.get(id)?.items ?? []).filter((i) => i.at);

// Key figures: the first fact of a few blocks, in large type.
const KEYS = ['air', 'internet', 'immobilier'];
const renderKeys = () => {
  $('keys').replaceChildren(...KEYS.map((id) => {
    const b = BLOCKS.find((x) => x.id === id)!, v = views.get(id), f = v?.facts[0];
    return make('a', { className: 'key', href: `#bloc-${id}`, onclick: (e: Event) => { e.preventDefault(); $(`bloc-${id}`).scrollIntoView({ behavior: 'smooth' }); } },
      make('strong', { className: 'key-value' }, v === undefined ? '…' : f?.value ?? 'Indisponible'),
      make('span', { className: 'key-label' }, f ? `${b.title} : ${f.label}` : b.title));
  }));
};

const renderThemes = () => {
  $('themes').replaceChildren(make('ul', {}, ...BLOCKS.map((b) => {
    const count = mapItems(b.id).length, active = b.id === activeTheme;
    const btn = make('button', { type: 'button', className: `theme${active ? ' is-active' : ''}` }, b.title);
    if (count) btn.append(make('sup', {}, `(${count})`));
    if (active) btn.setAttribute('aria-current', 'true');
    btn.addEventListener('click', () => {
      if (count) { activeTheme = b.id; picked = true; selected = 0; renderThemes(); renderPlaces(); }
      else $(`bloc-${b.id}`).scrollIntoView({ behavior: 'smooth' });
    });
    return make('li', {}, btn);
  })));
  $('themes').hidden = false;
};

// Places of the active theme: numbered markers, a strip of cards, the walking route to the selected one.
const renderPlaces = (fit = true) => {
  if (!here) return;
  const items = mapItems(activeTheme), title = BLOCKS.find((b) => b.id === activeTheme)!.title;
  const pick = (i: number) => { selected = i; renderPlaces(false); };
  sheetMap.setMarkers([
    ...items.map((it, i) => ({ ...it.at!, text: two(i), label: it.name, selected: i === selected, onClick: () => pick(i) })),
    { lat: here.lat, lon: here.lon, label: here.label, kind: 'main' as const },
  ]);
  sheetMap.setRoute(items[selected]?.walk?.line);
  if (fit && items.length) sheetMap.fit([here, ...items.slice(0, 6).map((i) => i.at!)]);
  $('strip-label').textContent = items.length ? `${title}, du plus proche au plus loin` : '';
  $('strip').replaceChildren(...items.map((it, i) => {
    const card = make('button', { type: 'button', className: `card${i === selected ? ' is-selected' : ''}` },
      make('span', { className: 'badge' }, two(i)),
      make('span', { className: 'card-body' },
        make('strong', {}, it.name),
        ...(it.detail ? [make('span', { className: 'card-detail' }, it.detail)] : []),
        make('span', { className: 'card-dist' }, it.walk ? formatWalk(it.walk) : it.distance !== undefined ? `${formatDistance(it.distance)} à vol d’oiseau` : '')));
    card.setAttribute('aria-pressed', String(i === selected));
    card.addEventListener('click', () => pick(i));
    return make('li', {}, card);
  }));
  $('stage-bottom').hidden = false;
  if (fit) $('strip').scrollLeft = 0;
};

const onBlock = (b: Block, v: BlockView | null) => {
  views.set(b.id, v);
  renderKeys();
  renderThemes();
  // Default theme: the first of PREFERRED with places, waiting for a block before skipping it.
  if (!picked) {
    const first = PREFERRED.find((id) => !views.has(id) || mapItems(id).length);
    if (first && mapItems(first).length) { activeTheme = first; picked = true; }
  }
  if (b.id === activeTheme) renderPlaces();
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
  $('themes').hidden = $('stage-bottom').hidden = true;
  views = new Map();
  activeTheme = 'ecoles';
  selected = 0;
  picked = false;
  try {
    const place = await placeFor(point);
    if (!place) {
      title.textContent = 'Aucune adresse à cet endroit';
      sheetStatus.textContent = 'Ce point ne correspond à aucune adresse connue en France.';
      return;
    }
    title.textContent = place.label;
    here = place;
    sheetMap.setView(place, 16);
    sheetMap.setRoute(undefined);
    sheetMap.setMarkers([{ ...place, label: place.label, kind: 'main' }]);
    renderKeys();
    renderThemes();
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
