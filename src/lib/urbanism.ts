// Town planning at the address, from the Géoportail de l'urbanisme (GPU, IGN) through the API Carto:
// PLU/PLUi zone or carte communale sector, the document itself, public-utility easements (SUP),
// the plan's prescriptions, and the cadastral parcel. Pure functions only, tested on real answers.

import type { BlockView, Fact, Item, Note } from './block.ts';

const API = 'https://apicarto.ign.fr/api';
export const GPU_URL = 'https://www.geoportail-urbanisme.gouv.fr/';
export const documentUrl = (id: string) => `${GPU_URL}document/by-id/${encodeURIComponent(id)}`;

export type Layer = 'municipality' | 'document' | 'zone-urba' | 'secteur-cc' | 'assiette-sup-s' | 'prescription-surf' | 'cadastre';
/** assiette-sup-s, not acte-sup: acte-sup ignores `geom` and returns unrelated acts. */
export const layerUrl = (layer: Layer, { lat, lon }: { lat: number; lon: number }) =>
  `${API}/${layer === 'cadastre' ? 'cadastre/parcelle' : `gpu/${layer}`}?geom=${encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }))}`;

/** Only the attributes: the geometries (up to 1 MB) are never used. */
export const props = (json: any): any[] => (json?.features ?? []).map((f: any) => f.properties ?? {});

/** Each layer's features' properties, or null when the call failed or timed out. */
export type Layers = Partial<Record<Layer, any[] | null>>;

const utf8 = new TextDecoder('utf-8', { fatal: true });
/** Some SUP names are UTF-8 read as Latin-1 ("HÃ´tel des Invalides"): decode them back, keep the rest. */
export const fixText = (s: string) => {
  if (!/[ÂÃ]/.test(s) || [...s].some((c) => c.charCodeAt(0) > 255)) return s;
  try { return utf8.decode(Uint8Array.from(s, (c) => c.charCodeAt(0))); } catch { return s; }
};

/** "20251106" → "06/11/2025". */
export const gpuDate = (d?: string | null) => /^\d{8}$/.test(d ?? '') ? `${d!.slice(6)}/${d!.slice(4, 6)}/${d!.slice(0, 4)}` : undefined;

// Zone families of the PLU, code de l'urbanisme: R151-18 (U), R151-20 (AU, "AUc" open now, "AUs" later),
// R151-22 and R151-23 (A), R151-24 and R151-25 (N).
const FAMILIES: Record<string, string> = {
  U: 'Zone urbaine : secteur déjà urbanisé, ou dont les équipements publics suffisent pour de nouvelles constructions.',
  AUc: 'Zone à urbaniser : secteur destiné à être construit, ouvert à la construction dans les conditions du plan.',
  AUs: 'Zone à urbaniser plus tard : son ouverture à la construction demande une modification ou une révision du plan.',
  A: 'Zone agricole : secteur protégé pour la valeur de ses terres, où l’on construit surtout pour l’agriculture.',
  N: 'Zone naturelle et forestière : secteur protégé pour ses paysages, ses milieux naturels ou ses forêts, où l’on construit très peu.',
};
export const family = (typezone?: string) =>
  !typezone ? undefined : FAMILIES[typezone] ?? FAMILIES[typezone.startsWith('AU') ? 'AUc' : typezone[0]];

const DOC_TYPES: Record<string, string> = {
  PLU: 'Plan local d’urbanisme (PLU)', PLUi: 'Plan local d’urbanisme intercommunal (PLUi)', CC: 'Carte communale',
  PSMV: 'Plan de sauvegarde et de mise en valeur (PSMV)', POS: 'Plan d’occupation des sols (POS)',
};

// SUP categories (nomenclature annexed to article R151-51 of the code de l'urbanisme), the frequent ones.
const SUP_TYPES: Record<string, string> = {
  ac1: 'abords de monument historique', ac2: 'site inscrit ou classé', ac3: 'réserve naturelle', ac4: 'site patrimonial remarquable',
  as1: 'protection d’un captage d’eau potable', a5: 'canalisation d’eau ou d’assainissement', el7: 'alignement de voie',
  i3: 'canalisation de gaz', i4: 'ligne électrique', int1: 'voisinage d’un cimetière', pm1: 'plan de prévention des risques naturels',
  pm3: 'plan de prévention des risques technologiques', pt1: 'télécommunications (perturbations)', pt2: 'télécommunications (obstacles)',
  t1: 'voie ferrée', t5: 'dégagement aéronautique', t7: 'servitude aéronautique hors dégagement',
};
export const supLabel = (t: string) => SUP_TYPES[t?.toLowerCase()] ?? `servitude ${t?.toUpperCase()}`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unknown = (label: string): Fact => ({ label, value: 'Donnée indisponible', level: 'unknown', detail: 'Le Géoportail de l’urbanisme n’a pas répondu à temps.' });

const zoneFact = (l: Layers, doc: any): Fact => {
  const zone = l['zone-urba']?.[0], sector = l['secteur-cc']?.[0];
  if (zone) {
    const label = `${zone.libelle}${zone.libelong && zone.libelong !== zone.libelle ? ` : ${fixText(zone.libelong)}` : ''}`;
    const psmv = /PSMV/i.test(zone.libelle) || /sauvegarde/i.test(zone.libelong ?? '');
    return {
      label: `Zone du ${doc?.du_type ?? 'PLU'}`, value: label, level: 'info',
      detail: psmv ? 'Secteur sauvegardé : les règles sont celles du plan de sauvegarde et de mise en valeur, à consulter en mairie.' : family(zone.typezone),
    };
  }
  if (sector) return { label: 'Secteur de la carte communale', value: fixText(sector.libelong || sector.libelle), level: 'info' };
  if (l.municipality?.some((m) => m.is_rnu)) return {
    label: 'Règles applicables', value: 'Règlement national d’urbanisme (pas de document local)', level: 'info',
    detail: 'La commune n’a ni PLU ni carte communale : les règles nationales s’appliquent, et l’on construit surtout dans les parties déjà urbanisées.',
  };
  if (l['zone-urba'] === null && l['secteur-cc'] === null) return unknown('Zone d’urbanisme');
  return { label: 'Zone d’urbanisme', value: 'Document non disponible sur le Géoportail de l’urbanisme', level: 'unknown', detail: 'Renseignez-vous auprès de la mairie.' };
};

const docFact = (doc: any, approved?: string): Fact => {
  const last = gpuDate(doc.name?.match(/_(\d{8})$/)?.[1]);
  const dates = [approved && `Approuvé le ${approved}`, last && last !== approved && `dernière procédure le ${last}`].filter(Boolean).join(', ');
  return { label: 'Document d’urbanisme', value: DOC_TYPES[doc.du_type] ?? doc.du_type, level: 'info', ...(dates ? { detail: `${dates}.` } : {}) };
};

const supFact = (sups: any[] | null | undefined): Fact => {
  if (!sups) return unknown('Servitudes d’utilité publique');
  if (!sups.length) return { label: 'Servitudes d’utilité publique', value: 'Aucune au point', level: 'info' };
  const kinds = [...new Set(sups.map((s) => s.suptype?.toLowerCase()))];
  const names = [...new Set(sups.map((s) => fixText(s.nomsuplitt ?? '').trim()).filter(Boolean))];
  const shown = names.slice(0, 4).join(', ');
  return {
    label: 'Servitudes d’utilité publique', value: cap(kinds.map(supLabel).join(', ')), level: 'info',
    ...(names.length ? { detail: `${shown}${names.length > 4 ? ` et ${names.length - 4} autres` : ''}.` } : {}),
  };
};

const parcelFact = (parcels: any[] | null | undefined): Fact => {
  const p = parcels?.[0];
  if (!parcels) return unknown('Parcelle cadastrale');
  if (!p) return { label: 'Parcelle cadastrale', value: 'Aucune parcelle au point', level: 'info', detail: 'Le point tombe sans doute sur une voie ou un espace public.' };
  const area = p.contenance ? `, ${Number(p.contenance).toLocaleString('fr-FR')} m²` : '';
  return { label: 'Parcelle cadastrale', value: `Section ${p.section}, n° ${String(p.numero).replace(/^0+/, '')}`, level: 'info', detail: `${p.nom_com}, référence ${p.idu}${area}.` };
};

export const urbanismView = (l: Layers): BlockView => {
  const doc = l.document?.[0];
  const zone = l['zone-urba']?.[0];
  const rnu = !doc && l.municipality?.some((m) => m.is_rnu);
  const approved = gpuDate(zone?.datvalid ?? l['secteur-cc']?.[0]?.datvalid);
  const facts = [zoneFact(l, doc), ...(doc ? [docFact(doc, approved)] : []), supFact(l['assiette-sup-s']), parcelFact(l.cadastre)];

  const items: Item[] = [
    ...(doc ? [{ name: `Consulter le ${doc.du_type ?? 'document'} sur le Géoportail de l’urbanisme`, detail: 'règlement, plans et annexes', url: documentUrl(doc.gpu_doc_id) }] : []),
    ...[...new Set((l['prescription-surf'] ?? []).map((p) => fixText(p.libelle ?? '').trim()).filter(Boolean))]
      .map((name) => ({ name, detail: 'prescription du plan à cet endroit' })),
  ];

  const notes: Note[] = [
    'Ces informations ne valent pas certificat. Pour un projet, demandez un certificat d’urbanisme à la mairie.',
    'La zone peut changer si une révision ou une modification du plan est en cours : la mairie peut vous le dire.',
    ...(doc && l['prescription-surf'] === null ? ['Les prescriptions du plan (hauteurs, stationnement, protections…) n’ont pas pu être chargées à temps : consultez le document.'] : []),  ];
  const last = gpuDate(doc?.name?.match(/_(\d{8})$/)?.[1]);
  return {
    facts,
    explanation: rnu
      ? 'Sans document local, un projet est instruit selon le règlement national d’urbanisme, souvent par les services de l’État.'
      : 'Le plan d’urbanisme découpe le territoire en zones et fixe pour chacune ce que l’on peut construire. Les servitudes d’utilité publique s’y ajoutent : près d’un monument historique, par exemple, les travaux passent par l’avis de l’architecte des Bâtiments de France.',
    items,
    precision: 'parcelle',
    source: { name: 'Géoportail de l’urbanisme (IGN), via l’API Carto', url: doc ? documentUrl(doc.gpu_doc_id) : GPU_URL, ...(last ? { updated: `document du ${last}` } : {}) },
    notes,
  };
};
