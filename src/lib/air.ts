// Daily ATMO index per commune, national WFS of Atmo France (no key, CORS open). Pure functions only.
// See docs/feasibility/air-bruit.md, section 1b.
import type { BlockView, Fact, Level } from './block.ts';

const WFS = 'https://data.atmo-france.org/geoserver/ind/ows';
export const DATASET_URL = 'https://www.data.gouv.fr/datasets/indice-de-la-qualite-de-lair-quotidien-par-commune-indice-atmo';

/** The layer only holds the current days (today, and tomorrow once published around 14 h). */
export const indiceUrl = (insee: string) => `${WFS}?${new URLSearchParams({
  service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 'ind:ind_atmo_2021', outputFormat: 'application/json',
  propertyName: 'code_zone,lib_zone,date_ech,date_maj,code_qual,lib_qual,code_no2,code_o3,code_pm10,code_pm25,code_so2,source',
  // URLSearchParams encodes the quotes: unencoded, Tomcat answers 400.
  CQL_FILTER: `code_zone='${insee.replace(/'/g, '')}'`,
})}`;

// Arrêté du 10 juillet 2020 relatif à l'indice de la qualité de l'air ambiant: six classes, and the index of the
// day is the worst of the sub-indices of NO2, O3, PM10, PM2.5 and SO2. Codes 0 (absent) and 7 (événement) are
// Atmo France's own codes for "no index", shown as unknown.
const SCALE = ['Bon', 'Moyen', 'Dégradé', 'Mauvais', 'Très mauvais', 'Extrêmement mauvais'];
const LEVEL: Level[] = ['ok', 'info', 'warn', 'alert', 'alert', 'alert'];
const POLLUTANTS: Record<string, string> = {
  code_no2: 'dioxyde d’azote', code_o3: 'ozone', code_pm10: 'particules PM10', code_pm25: 'particules fines PM2,5', code_so2: 'dioxyde de soufre',
};

export type Indice = { date: string; code: number; label: string; zone: string; source: string; pollutants: string[] };

const list = (a: string[]) => a.length > 1 ? `${a.slice(0, -1).join(', ')} et ${a.at(-1)}` : a[0];

export const parseIndices = (json: any): Indice[] =>
  (json?.features ?? []).map(({ properties: p }: any) => ({
    date: p.date_ech,
    code: p.code_qual,
    label: SCALE[p.code_qual - 1] ?? p.lib_qual ?? 'Indisponible',
    zone: p.lib_zone,
    source: p.source,
    // The sub-indices equal to the index are the pollutants that set it.
    pollutants: Object.keys(POLLUTANTS).filter((k) => p[k] === p.code_qual).map((k) => POLLUTANTS[k]),
  })).sort((a: Indice, b: Indice) => a.date.localeCompare(b.date));

const frDate = (iso: string) => iso.split('-').reverse().join('/');
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);

const fact = (label: string, i: Indice): Fact => SCALE[i.code - 1]
  ? { label, value: `${i.label} (${i.code} sur 6)`, level: LEVEL[i.code - 1],
      ...(i.code > 1 && i.pollutants.length ? { detail: `${i.pollutants.length > 1 ? 'Polluants' : 'Polluant'} qui fixe${i.pollutants.length > 1 ? 'nt' : ''} l’indice : ${list(i.pollutants)}.` } : {}) }
  : { label, value: i.label, level: 'unknown' };

/** `today` is the ISO date in Paris ("2026-09-24"). */
export const airView = (indices: Indice[], today: string): BlockView => {
  const tomorrow = nextDay(today);
  const d0 = indices.find((i) => i.date === today), d1 = indices.find((i) => i.date === tomorrow);
  const latest = d0 ?? d1 ?? indices.at(-1);
  const facts: Fact[] = !latest
    ? [{ label: 'Indice ATMO', value: 'Pas d’indice publié pour cette commune', level: 'unknown' }]
    : !d0 && !d1
      ? [fact(`Dernier indice (${frDate(latest.date)})`, latest)]
      : [
        d0 ? fact('Aujourd’hui', d0) : { label: 'Aujourd’hui', value: 'Pas encore publié', level: 'unknown' },
        d1 ? fact('Demain', d1) : { label: 'Demain', value: 'Pas encore publié', level: 'unknown', detail: 'La prévision du lendemain paraît vers 14 h.' },
      ];
  return {
    facts,
    explanation: 'L’indice ATMO résume la qualité de l’air de la commune pour une journée, de 1 (bon) à 6 (extrêmement mauvais), d’après le polluant le plus présent parmi le dioxyde d’azote, l’ozone, les particules et le dioxyde de soufre. C’est une prévision ou une mesure du jour. L’indice du jour ne dit pas l’exposition moyenne sur l’année.',
    precision: latest ? `à la commune (${latest.zone})` : 'à la commune',
    source: {
      name: `${latest?.source ? `${latest.source}, ` : ''}réseau Atmo France (licence ODbL)`,
      url: DATASET_URL,
      ...(latest ? { updated: frDate(latest.date) } : {}),
    },
  };
};
