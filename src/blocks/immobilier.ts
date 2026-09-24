import type { Block } from '../lib/block.ts';

export const immobilier: Block = {
  id: 'immobilier',
  title: 'Immobilier',
  load: async () => { throw new Error('Bloc en préparation'); },
};
