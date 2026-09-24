import type { Block } from '../lib/block.ts';

export const sun: Block = {
  id: 'sun',
  title: 'Soleil et orientation',
  load: async () => { throw new Error('Bloc en préparation'); },
};
