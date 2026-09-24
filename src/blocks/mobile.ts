import type { Block } from '../lib/block.ts';

export const mobile: Block = {
  id: 'mobile',
  title: 'Réseau mobile',
  load: async () => { throw new Error('Bloc en préparation'); },
};
