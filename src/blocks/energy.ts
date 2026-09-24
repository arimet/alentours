import type { Block } from '../lib/block.ts';

export const energy: Block = {
  id: 'energy',
  title: 'Énergie des logements (DPE)',
  load: async () => { throw new Error('Bloc en préparation'); },
};
