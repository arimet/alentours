import type { Block } from '../lib/block.ts';

export const tax: Block = {
  id: 'tax',
  title: 'Taxe foncière',
  load: async () => { throw new Error('Bloc en préparation'); },
};
