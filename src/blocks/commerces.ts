import type { Block } from '../lib/block.ts';

export const commerces: Block = {
  id: 'commerces',
  title: 'Commerces et services',
  load: async () => { throw new Error('Bloc en préparation'); },
};
