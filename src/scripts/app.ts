import { parseFragment, toFragment, type Point } from '../lib/fragment';
import { parsePlaces, precisionOf, communeCode, searchUrl, reverseUrl, type Place } from '../lib/geocode';
import { getJson } from '../lib/http';
import { EXAMPLES } from '../lib/examples';
import homeRoutes from '../data/home-routes.json';
import { BLOCKS, GROUPS } from '../blocks';
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

// Home map: metropolitan France with its main road corridors drawing in (scripts/routes.mjs).
// On wide screens a white side panel covers the left of the map: keep the subject to its right.
const focusX = () => (innerWidth > 896 ? 0.64 : 0.5);
const homeMap = createMap($('home-map'), { zoom: 5, minZoom: 4, maxZoom: 9, label: 'Carte de France avec des adresses d’exemple', focusX });
homeMap.setView({ lat: 46.6, lon: 2.4 }, 6);
homeMap.setLines(homeRoutes.lines as [number, number][][]);

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
let activeTheme = 'schools';
let selected = 0;
const PREFERRED = ['schools', 'health', 'shops'];

const mapItems = (id: string) => (views.get(id)?.items ?? []).filter((i) => i.at);

// Key figures: the first fact of a few blocks, in large type.
const KEYS = ['air', 'internet', 'housing'];
const renderKeys = () => {
  $('keys').hidden = false;
  $('keys').replaceChildren(...KEYS.map((id) => {
    const b = BLOCKS.find((x) => x.id === id)!, v = views.get(id), f = v?.facts[0];
    return make('a', { className: 'key', href: `#block-${id}`, onclick: (e: Event) => { e.preventDefault(); $(`block-${id}`).scrollIntoView({ behavior: 'smooth' }); } },
      make('strong', { className: 'key-value' }, v === undefined ? '…' : f?.value ?? 'Indisponible'),
      make('span', { className: 'key-label' }, f ? `${b.title} : ${f.label}` : b.title));
  }));
};

// Themes drawn on the map come first; the others only scroll to their block below the map.
const MAP_THEMES = ['schools', 'health', 'shops'];
const renderThemes = () => {
  $('themes-map-list').replaceChildren(...MAP_THEMES.map((id) => {
    const b = BLOCKS.find((x) => x.id === id)!, count = mapItems(id).length, active = id === activeTheme;
    const btn = make('button', { type: 'button', className: `theme${active ? ' is-active' : ''}` }, b.title,
      make('sup', {}, views.has(id) ? `(${count})` : '(…)'));
    if (active) btn.setAttribute('aria-current', 'true');
    btn.disabled = views.has(id) && !count;
    btn.addEventListener('click', () => { activeTheme = id; selected = 0; renderThemes(); renderPlaces(); });
    return make('li', {}, btn);
  }));
  $('themes-more-list').replaceChildren(...BLOCKS.filter((b) => !MAP_THEMES.includes(b.id)).map((b) =>
    make('li', {}, make('a', { href: `#block-${b.id}`, className: 'theme-link', onclick: (e: Event) => { e.preventDefault(); $(`block-${b.id}`).scrollIntoView({ behavior: 'smooth' }); } }, b.title))));
  $('themes-map').hidden = $('themes-more').hidden = false;
};

// Parts of the map covered by the panels drawn over it (none on narrow screens, where they flow below).
const coveredMargins = () => {
  const wide = innerWidth > 896;
  return {
    top: 40, right: wide ? 90 : 70,
    bottom: wide ? $('stage-strip').offsetHeight + 20 : 30,
    left: wide ? $('sheet-map').closest('.stage')!.querySelector<HTMLElement>('.stage-side')!.offsetWidth : 30,
  };
};

// Strip arrows: one screenful of cards at a time; disabled at the ends.
const strip = $('strip'), prev = $<HTMLButtonElement>('strip-prev'), nextBtn = $<HTMLButtonElement>('strip-next');
const syncArrows = () => {
  prev.disabled = strip.scrollLeft <= 2;
  nextBtn.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
};
const page = (dir: 1 | -1) => {
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  strip.scrollBy({ left: dir * strip.clientWidth, behavior });
  setTimeout(syncArrows, 450); // the scroll event can lag behind a smooth scroll
};
prev.addEventListener('click', () => page(-1));
nextBtn.addEventListener('click', () => page(1));
strip.addEventListener('scroll', syncArrows, { passive: true });
new ResizeObserver(syncArrows).observe(strip);

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
  // The active theme is already named in the menu (and in the tabs on mobile).
  $('strip-label').textContent = items.length ? 'Du plus proche au plus loin' : '';
  $('strip').setAttribute('aria-label', `${title}, du plus proche au plus loin`);
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
  $('stage-strip').hidden = false;
  if (fit) strip.scrollLeft = 0;
  syncArrows();
  // Frame all the places, once the strip is laid out (its height is part of the covered margins).
  if (fit && items.length) sheetMap.fit([here, ...items.map((i) => i.at!)], coveredMargins());
};

// The stage (map, themes, places, key figures) shows once its blocks have answered, in one go,
// rather than filling in piece by piece. Slow blocks elsewhere (risks…) don't hold it.
const STAGE_BLOCKS = [...MAP_THEMES, ...KEYS];
const STAGE_TIMEOUT_MS = 15000;
let revealTimer: ReturnType<typeof setTimeout> | undefined;
const reveal = () => {
  clearTimeout(revealTimer);
  if (!$('sheet-stage').classList.contains('is-loading')) return;
  activeTheme = PREFERRED.find((id) => mapItems(id).length) ?? activeTheme;
  renderKeys();
  renderThemes();
  $('sheet-stage').classList.remove('is-loading');
  renderPlaces();
};
const onBlock = (b: Block, v: BlockView | null) => {
  views.set(b.id, v);
  if ($('sheet-stage').classList.contains('is-loading')) {
    if (STAGE_BLOCKS.every((id) => views.has(id))) reveal();
    return;
  }
  renderKeys();
  renderThemes();
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
  $('themes-map').hidden = $('themes-more').hidden = $('stage-strip').hidden = $('keys').hidden = true;
  views = new Map();
  activeTheme = 'schools';
  selected = 0;
  clearTimeout(revealTimer);
  $('sheet-stage').classList.add('is-loading');
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
    revealTimer = setTimeout(reveal, STAGE_TIMEOUT_MS);
    document.title = `${place.label} · Alentours`;
    meta.textContent = `Commune : ${place.city} (INSEE ${place.citycode}). Précision de la localisation : ${precisionOf(place.type)}.`;
    mountBlocks($('blocks'), BLOCKS, {
      lat: place.lat, lon: place.lon, label: place.label,
      citycode: place.citycode, commune: communeCode(place.citycode), city: place.city,
      housenumber: place.housenumber, street: place.street,
    }, {
      groups: GROUPS,
      toc: $('toc'),
      onDone: onBlock,
      onMap: { ids: MAP_THEMES, show: (id) => {
        activeTheme = id; selected = 0;
        renderThemes(); renderPlaces();
        $('sheet-stage').scrollIntoView({ behavior: 'smooth' });
      } },
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
  document.title = 'Alentours';
  if (location.hash.length > 1) status.textContent = 'Ce lien ne contient pas de coordonnées valides.';
};
addEventListener('hashchange', route);
route();
