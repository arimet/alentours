// Plan IGN tiles (Géoplateforme WMTS, Web Mercator "PM" grid), for the small situation map.
/** Web Mercator "world pixel" of a point at zoom z (256 px tiles). */
export const project = ({ lat, lon }: { lat: number; lon: number }, z: number) => {
  const n = 2 ** z * 256;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
};

export const tileOf = (p: { lat: number; lon: number }, z: number) => {
  const { x: fx, y: fy } = project(p, z);
  return { x: Math.floor(fx / 256), y: Math.floor(fy / 256), px: fx % 256, py: fy % 256 };
};

export const tileUrl = (z: number, x: number, y: number) =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`;
