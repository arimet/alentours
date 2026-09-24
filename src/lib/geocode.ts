// Géoplateforme geocoder (IGN), which replaces api-adresse.data.gouv.fr (sunset 31/01/2026).
// Same GeoJSON answer as the Base Adresse Nationale API. See docs/feasibility/geo-risques-eau.md.
export const GEOCODER = 'https://data.geopf.fr/geocodage';

export type PlaceType = 'housenumber' | 'street' | 'locality' | 'municipality';
export type Place = {
  label: string;
  lat: number;
  lon: number;
  citycode: string;
  city: string;
  postcode?: string;
  type: PlaceType;
};

export const parsePlaces = (json: any): Place[] =>
  (json?.features ?? []).map(({ geometry, properties: p }: any) => ({
    // In Lyon the geocoder appends the district after a comma ("… 69002 Lyon,Lyon 2e Arrondissement").
    label: p.label.split(',')[0],
    lat: geometry.coordinates[1],
    lon: geometry.coordinates[0],
    citycode: p.citycode,
    city: p.city,
    ...(p.postcode && { postcode: p.postcode }),
    type: p.type,
  }));

const PRECISION: Record<PlaceType, string> = {
  housenumber: 'adresse', street: 'rue', locality: 'lieu-dit', municipality: 'commune',
};
export const precisionOf = (type: PlaceType) => PRECISION[type];

// The geocoder returns the district code in Paris, Lyon and Marseille; most
// commune-level datasets (Hub'Eau…) only know the whole commune.
const DISTRICTS: [number, number, string][] = [
  [75101, 75120, '75056'], [69381, 69389, '69123'], [13201, 13216, '13055'],
];
export const communeCode = (citycode: string) =>
  DISTRICTS.find(([from, to]) => +citycode >= from && +citycode <= to)?.[2] ?? citycode;

export const searchUrl = (q: string) =>
  `${GEOCODER}/search?${new URLSearchParams({ q, autocomplete: '1', limit: '6' })}`;
export const reverseUrl = ({ lat, lon }: { lat: number; lon: number }) =>
  `${GEOCODER}/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lon), limit: '1' })}`;
