import { project, tileUrl } from '../lib/tiles';

// A small tile map without a library: Plan IGN tiles laid out around a centre, round markers,
// and +/− buttons. No dragging: the map follows the address, the lists carry the detail.
export type Marker = {
  lat: number; lon: number;
  /** Shown on hover; the lists below repeat every marker for screen readers. */
  label: string;
  kind?: 'main' | 'poi';
  /** Clickable markers are real buttons (home page examples). */
  onClick?: () => void;
};

export const createMap = (root: HTMLElement, opts: { zoom: number; minZoom?: number; maxZoom?: number; label: string }) => {
  const { minZoom = 5, maxZoom = 18 } = opts;
  let zoom = opts.zoom, center = { lat: 46.6, lon: 2.4 }, markers: Marker[] = [];
  root.classList.add('map');
  root.replaceChildren();
  const tiles = Object.assign(document.createElement('div'), { className: 'map-tiles' });
  tiles.setAttribute('role', 'img');
  tiles.setAttribute('aria-label', opts.label);
  const pins = Object.assign(document.createElement('div'), { className: 'map-pins' });
  const controls = Object.assign(document.createElement('div'), { className: 'map-zoom' });
  const button = (text: string, label: string, dz: number) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text, title: label });
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => { zoom = Math.min(maxZoom, Math.max(minZoom, zoom + dz)); render(); });
    return b;
  };
  controls.append(button('+', 'Zoomer', 1), button('−', 'Dézoomer', -1));
  const credit = Object.assign(document.createElement('p'), { className: 'map-credit', textContent: 'Plan IGN, © IGN Géoplateforme' });
  root.append(tiles, pins, controls, credit);

  const render = () => {
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;
    const c = project(center, zoom), n = 2 ** zoom;
    const left = c.x - w / 2, top = c.y - h / 2;
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
    pins.replaceChildren(...markers.map((m) => {
      const p = project(m, zoom);
      const el = document.createElement(m.onClick ? 'button' : 'span');
      el.className = `pin pin-${m.kind ?? 'poi'}`;
      el.title = m.label;
      if (m.onClick) { el.setAttribute('aria-label', m.label); el.addEventListener('click', m.onClick); }
      else el.setAttribute('aria-hidden', 'true');
      el.style.transform = `translate(${Math.round(p.x - left)}px, ${Math.round(p.y - top)}px)`;
      return el;
    }));
  };
  new ResizeObserver(render).observe(root);

  return {
    setView(c: { lat: number; lon: number }, z = zoom) { center = c; zoom = z; render(); },
    setMarkers(ms: Marker[]) { markers = ms; render(); },
    addMarkers(ms: Marker[]) { markers = [...markers, ...ms]; render(); },
  };
};
