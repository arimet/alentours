import type { Block } from '../lib/block.ts';

export const climate: Block = {
  id: 'climate',
  title: 'Climat futur',
  load: async () => { throw new Error('Bloc en préparation'); },
};
