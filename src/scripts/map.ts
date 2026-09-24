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
  // Where `center` is drawn, as fractions of the width and height (fit() moves it into the free area).
  let anchor: { x: number; y: number } | null = null;
  let markers: Marker[] = [], route: [number, number][] = [];
  // Decorative lines (home page roads): drawn in with an animation during their first seconds only
  // (renders in that window, e.g. the first resize, just restart it unnoticed).
  let lines: [number, number][][] = [], drawUntil = 0;
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
    button('⌖', 'Recentrer sur l’adresse', 'map-recenter', () => { center = home; anchor = null; render(); }),
    button('+', 'Zoomer', 'map-zoom-btn', () => zoomBy(1)),
    button('−', 'Dézoomer', 'map-zoom-btn', () => zoomBy(-1)),
  );
  const credit = Object.assign(el('p', 'map-credit'), { textContent: 'Plan IGN, © IGN Géoplateforme' });
  root.append(tiles, svg, pins, controls, credit);

  const render = () => {
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;
    const c = project(center, zoom), n = 2 ** zoom;
    const left = c.x - w * (anchor?.x ?? focusX()), top = c.y - h * (anchor?.y ?? 0.5);
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
    const pts = (l: [number, number][]) => l.map(([lon, lat]) => at({ lat, lon }).join(',')).join(' ');
    svg.innerHTML = lines.map((l, i) =>
      `<polyline class="map-line${Date.now() < drawUntil ? ' is-drawing' : ''}" pathLength="1" style="--i:${i}" points="${pts(l)}" />`).join('')
      + (route.length ? `<polyline class="map-walk" points="${pts(route)}" />` : '');
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
    setView(c: Pt, z = zoom) { center = home = c; zoom = z; anchor = null; render(); },
    setMarkers(ms: Marker[]) { markers = ms; render(); },
    setRoute(line: [number, number][] | undefined) { route = line ?? []; render(); },
    setLines(ls: [number, number][][]) { lines = ls; drawUntil = Date.now() + 1500; render(); },
    /**
     * Frames every point (largest zoom that fits) inside the part of the map left free by the
     * panels drawn over it: `pad` gives the covered margins in px.
     */
    fit(points: Pt[], pad: { top: number; right: number; bottom: number; left: number }) {
      const W = root.clientWidth, H = root.clientHeight;
      const freeW = W - pad.left - pad.right, freeH = H - pad.top - pad.bottom;
      if (!points.length || freeW < 50 || freeH < 50) return;
      let z = maxZoom, box = { x0: 0, x1: 0, y0: 0, y1: 0 };
      for (; z >= minZoom; z--) {
        const ps = points.map((p) => project(p, z));
        box = { x0: Math.min(...ps.map((p) => p.x)), x1: Math.max(...ps.map((p) => p.x)), y0: Math.min(...ps.map((p) => p.y)), y1: Math.max(...ps.map((p) => p.y)) };
        if (box.x1 - box.x0 <= freeW && box.y1 - box.y0 <= freeH) break;
      }
      zoom = Math.max(z, minZoom);
      // Centre of the box, drawn at the centre of the free area.
      const n = 2 ** zoom * 256, cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      const lon = (cx / n) * 360 - 180, lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / n))) * 180) / Math.PI;
      center = { lat, lon };
      anchor = { x: (pad.left + freeW / 2) / W, y: (pad.top + freeH / 2) / H };
      render();
    },
  };
};
