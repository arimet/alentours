// Plan IGN tiles (Géoplateforme WMTS, Web Mercator "PM" grid), for the small situation map.
export const tileOf = ({ lat, lon }: { lat: number; lon: number }, z: number) => {
  const n = 2 ** z * 256;
  const fx = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x: Math.floor(fx / 256), y: Math.floor(fy / 256), px: fx % 256, py: fy % 256 };
};

export const tileUrl = (z: number, x: number, y: number) =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`;
