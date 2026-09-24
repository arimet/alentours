import type { Block } from '../lib/block';
import { risques } from './risques';
import { eau } from './eau';
import { ecoles } from './ecoles';
import { sante } from './sante';

// Sheet order.
export const BLOCKS: Block[] = [risques, eau, ecoles, sante];
