import type { Block } from '../lib/block.ts';

export const bruit: Block = {
  id: 'bruit',
  title: 'Bruit',
  load: async () => { throw new Error('Bloc en préparation'); },
};
