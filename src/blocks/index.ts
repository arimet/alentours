import type { Block } from '../lib/block';
import { risks } from './risks';
import { water } from './water';
import { air } from './air';
import { noise } from './noise';
import { climate } from './climate';
import { internet } from './internet';
import { mobile } from './mobile';
import { housing } from './housing';
import { energy } from './energy';
import { tax } from './tax';
import { urbanism } from './urbanism';
import { schools } from './schools';
import { health } from './health';
import { shops } from './shops';
import { chargers } from './chargers';

// Sheet order, as in the plan.
export const BLOCKS: Block[] = [risks, water, air, noise, climate, internet, mobile, housing, energy, tax, urbanism, schools, health, shops, chargers];

// Families of the detail section, in sheet order.
export const GROUPS: { title: string; ids: string[] }[] = [
  { title: 'Environnement et risques', ids: ['risks', 'water', 'air', 'noise', 'climate'] },
  { title: 'Connexion', ids: ['internet', 'mobile'] },
  { title: 'Logement', ids: ['housing', 'energy', 'tax', 'urbanism'] },
  { title: 'Vie quotidienne', ids: ['schools', 'health', 'shops', 'chargers'] },
];
