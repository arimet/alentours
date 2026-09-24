import type { Block } from '../lib/block.ts';

export const urbanism: Block = {
  id: 'urbanism',
  title: 'Urbanisme',
  load: async () => { throw new Error('Bloc en préparation'); },
};
