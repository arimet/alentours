import type { Block } from '../lib/block.ts';

export const internet: Block = {
  id: 'internet',
  title: 'Internet fixe',
  load: async () => { throw new Error('Bloc en préparation'); },
};
