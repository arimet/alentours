// The place lives in the URL fragment (#lat,lon): browsers never send it to the
// server nor to the audience counter, so no address leaves the visitor's browser.
export type Point = { lat: number; lon: number };

const NUM = '(-?\\d+(?:\\.\\d+)?)';
const FRAGMENT = new RegExp(`^#${NUM},${NUM}$`);

export const parseFragment = (hash: string): Point | null => {
  const m = FRAGMENT.exec(hash);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
};

export const toFragment = ({ lat, lon }: Point) => `#${+lat.toFixed(5)},${+lon.toFixed(5)}`;
