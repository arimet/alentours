import type { Block } from '../lib/block';
import { risks } from './risks';
import { water } from './water';
import { air } from './air';
import { noise } from './noise';
import { internet } from './internet';
import { mobile } from './mobile';
import { housing } from './housing';
import { schools } from './schools';
import { health } from './health';
import { shops } from './shops';

// Sheet order, as in the plan.
export const BLOCKS: Block[] = [risks, water, air, noise, internet, mobile, housing, schools, health, shops];

// Families of the detail section, in sheet order.
export const GROUPS: { title: string; ids: string[] }[] = [
  { title: 'Environnement et risques', ids: ['risks', 'water', 'air', 'noise'] },
  { title: 'Connexion', ids: ['internet', 'mobile'] },
  { title: 'Logement', ids: ['housing'] },
  { title: 'Vie quotidienne', ids: ['schools', 'health', 'shops'] },
];
