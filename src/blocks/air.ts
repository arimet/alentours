import type { Block } from '../lib/block.ts';

export const air: Block = {
  id: 'air',
  title: 'Air',
  load: async () => { throw new Error('Bloc en préparation'); },
};
