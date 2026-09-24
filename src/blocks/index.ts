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

// Sheet order, as in the plan.
export const BLOCKS: Block[] = [risques, eau, air, bruit, internet, mobile, immobilier, ecoles, sante];
