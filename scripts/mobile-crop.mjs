// Cuts a small square out of a mobile tile, for test fixtures:
//   node scripts/mobile-crop.mjs public/data/mobile/971.bin out.bin <lat> <lon> <half-size in cells>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseHeader, project, encodeTile, bytesPerCell, decodeCell, DATA_OFFSET } from '../src/lib/mobile.ts';

const [src, out, lat, lon, half] = process.argv.slice(2);
const file = readFileSync(src), h = parseHeader(file), n = Number(half), size = bytesPerCell(h.layers.length);
const [x, y] = project(h.epsg, Number(lat), Number(lon));
const col = Math.floor((x - h.x0) / h.cell) - n, row = Math.floor((h.y0 - y) / h.cell) - n, w = 2 * n + 1;
const grids = h.layers.map(() => new Uint8Array(w * w));
for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) {
  const at = DATA_OFFSET + ((row + r) * h.width + col + c) * size;
  decodeCell(h, file.subarray(at, at + size)).forEach((v, i) => (grids[i][r * w + c] = v));
}
writeFileSync(out, encodeTile({ ...h, x0: h.x0 + col * h.cell, y0: h.y0 - row * h.cell, width: w, height: w }, grids));
