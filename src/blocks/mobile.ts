import type { Block } from '../lib/block.ts';
import { dataUrl, departmentOf } from '../lib/data.ts';
import { DATA_OFFSET, cellRange, decodeCell, mobileView, parseHeader } from '../lib/mobile.ts';

const MISSING = 'Carte de couverture pas encore disponible pour ce département';

// Two Range requests (header, then the address's cell): a few kilobytes instead of the whole
// department file. A server that ignores Range answers 200 with the full file, which works too.
const bytes = async (url: string, from: number, to: number) => {
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to - 1}` }, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) throw new Error(MISSING);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const b = new Uint8Array(await res.arrayBuffer());
  return res.status === 206 ? b : b.subarray(from, to);
};

export const mobile: Block = {
  id: 'mobile',
  title: 'Réseau mobile',
  load: async (ctx) => {
    const url = dataUrl('mobile', departmentOf(ctx.commune), 'bin');
    const header = parseHeader(await bytes(url, 0, DATA_OFFSET));
    const r = cellRange(header, ctx.lat, ctx.lon);
    if (!r) throw new Error('adresse hors de la carte de couverture du département');
    return mobileView(header, decodeCell(header, await bytes(url, r.start, r.end)));
  },
};
