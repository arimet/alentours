import type { Block } from '../lib/block';
import { layerUrl, props, urbanismView, type Layer, type Layers } from '../lib/urbanism';

// Plain fetch, no sessionStorage cache: prescription answers weigh up to 1 MB (geometries included).
const load = (layer: Layer, p: { lat: number; lon: number }, timeout: number) =>
  fetch(layerUrl(layer, p), { signal: AbortSignal.timeout(timeout) })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(props)
    .catch(() => null);

const FAST: Layer[] = ['municipality', 'document', 'zone-urba', 'secteur-cc', 'assiette-sup-s', 'cadastre'];

export const urbanism: Block = {
  id: 'urbanism',
  title: 'Urbanisme',
  load: async (ctx) => {
    // All in parallel. Prescriptions take 2 to 3.5 s in town: capped so the zone never waits long on them.
    const [fast, prescriptions] = await Promise.all([
      Promise.all(FAST.map((l) => load(l, ctx, 8000))),
      load('prescription-surf', ctx, 5000),
    ]);
    const layers: Layers = Object.fromEntries(FAST.map((l, i) => [l, fast[i]]));
    layers['prescription-surf'] = prescriptions;
    if (!layers.municipality && !layers.document && !layers['zone-urba']) throw new Error('Géoportail de l’urbanisme indisponible');
    return urbanismView(layers);
  },
};
