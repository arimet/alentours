import type { Block } from '../lib/block';
import { risques } from './risques';
import { eau } from './eau';
import { air } from './air';
import { bruit } from './bruit';
import { internet } from './internet';
import { mobile } from './mobile';
import { immobilier } from './immobilier';
import { ecoles } from './ecoles';
import { sante } from './sante';
import { commerces } from './commerces';

// Sheet order, as in the plan.
export const BLOCKS: Block[] = [risques, eau, air, bruit, internet, mobile, immobilier, ecoles, sante, commerces];

// Families of the detail section, in sheet order.
export const GROUPS: { title: string; ids: string[] }[] = [
  { title: 'Environnement et risques', ids: ['risques', 'eau', 'air', 'bruit'] },
  { title: 'Connexion', ids: ['internet', 'mobile'] },
  { title: 'Logement', ids: ['immobilier'] },
  { title: 'Vie quotidienne', ids: ['ecoles', 'sante', 'commerces'] },
];
