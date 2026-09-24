import { project, tileUrl } from '../lib/tiles';

// A small tile map without a library: Plan IGN tiles laid out around a centre, markers, one route
// line and +/−/recentre buttons. No dragging: the map follows the address, the lists carry the detail.
export type Marker = {
  lat: number; lon: number;
  /** Shown on hover; the cards and lists repeat every marker for screen readers. */
  label: string;
  kind?: 'main' | 'poi';
  /** Short text inside the marker, e.g. "01". */
  text?: string;
  selected?: boolean;
  /** Clickable markers are real buttons (home page examples) or mouse shortcuts to a card. */
  onClick?: () => void;
  /** true: a real, focusable button; false: mouse only, the card is the keyboard path. */
  focusable?: boolean;
};

type Pt = { lat: number; lon: number };

// `focusX` is where the centre sits across the width (0.5 = middle), to leave room for a side panel.
export const createMap = (root: HTMLElement, opts: { zoom: number; minZoom?: number; maxZoom?: number; label: string; focusX?: () => number }) => {
  const focusX = opts.focusX ?? (() => 0.5);
  const { minZoom = 5, maxZoom = 18 } = opts;
  let zoom = opts.zoom, center: Pt = { lat: 46.6, lon: 2.4 }, home: Pt = center;
  let markers: Marker[] = [], route: [number, number][] = [];
  root.classList.add('map');
  root.replaceChildren();
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) => Object.assign(document.createElement(tag), { className: cls });
  const tiles = el('div', 'map-tiles');
  tiles.setAttribute('role', 'img');
  tiles.setAttribute('aria-label', opts.label);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('map-route');
  svg.setAttribute('aria-hidden', 'true');
  const pins = el('div', 'map-pins');
  const controls = el('div', 'map-controls');
  const button = (text: string, label: string, cls: string, onClick: () => void) => {
    const b = Object.assign(el('button', cls), { type: 'button', textContent: text, title: label });
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  };
  const zoomBy = (dz: number) => { zoom = Math.min(maxZoom, Math.max(minZoom, zoom + dz)); render(); };
  controls.append(
    button('⌖', 'Recentrer sur l’adresse', 'map-recenter', () => { center = home; render(); }),
    button('+', 'Zoomer', 'map-zoom-btn', () => zoomBy(1)),
    button('−', 'Dézoomer', 'map-zoom-btn', () => zoomBy(-1)),
  );
  const credit = Object.assign(el('p', 'map-credit'), { textContent: 'Plan IGN, © IGN Géoplateforme' });
  root.append(tiles, svg, pins, controls, credit);

  const render = () => {
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;
    const c = project(center, zoom), n = 2 ** zoom;
    const left = c.x - w * focusX(), top = c.y - h / 2;
    const at = (p: Pt) => { const q = project(p, zoom); return [Math.round(q.x - left), Math.round(q.y - top)]; };
    const imgs: HTMLImageElement[] = [];
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h) / 256); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w) / 256); tx++) {
        const img = Object.assign(document.createElement('img'), { src: tileUrl(zoom, ((tx % n) + n) % n, ty), alt: '', width: 256, height: 256 });
        img.style.transform = `translate(${Math.round(tx * 256 - left)}px, ${Math.round(ty * 256 - top)}px)`;
        imgs.push(img);
      }
    }
    tiles.replaceChildren(...imgs);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = route.length
      ? `<polyline points="${route.map(([lon, lat]) => at({ lat, lon }).join(',')).join(' ')}" />`
      : '';
    pins.replaceChildren(...markers.map((m) => {
      const [x, y] = at(m);
      const pin = el(m.onClick ? 'button' : 'span', `pin pin-${m.kind ?? 'poi'}${m.selected ? ' is-selected' : ''}`);
      pin.title = m.label;
      if (m.text) pin.textContent = m.text;
      if (m.onClick) {
        pin.addEventListener('click', m.onClick);
        if (m.focusable) pin.setAttribute('aria-label', m.label);
        else { pin.tabIndex = -1; pin.setAttribute('aria-hidden', 'true'); }
      } else pin.setAttribute('aria-hidden', 'true');
      pin.style.transform = `translate(${x}px, ${y}px)`;
      return pin;
    }));
  };
  new ResizeObserver(render).observe(root);

  return {
    setView(c: Pt, z = zoom) { center = home = c; zoom = z; render(); },
    setMarkers(ms: Marker[]) { markers = ms; render(); },
    setRoute(line: [number, number][] | undefined) { route = line ?? []; render(); },
    /** Largest zoom showing every point, the address staying in the middle. */
    fit(points: Pt[], pad = 90) {
      // Room on each side of the centre, which may sit off the middle (focusX).
      const W = root.clientWidth, h = root.clientHeight / 2 - pad;
      const leftRoom = W * focusX() - pad, rightRoom = W * (1 - focusX()) - pad;
      let z = maxZoom;
      for (; z > minZoom; z--) {
        const c = project(center, z);
        if (points.every((p) => { const q = project(p, z), dx = q.x - c.x; return (dx < 0 ? -dx <= leftRoom : dx <= rightRoom) && Math.abs(q.y - c.y) <= h; })) break;
      }
      zoom = z;
      render();
    },
  };
};
