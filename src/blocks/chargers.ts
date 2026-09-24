import type { Block } from '../lib/block.ts';

export const chargers: Block = {
  id: 'chargers',
  title: 'Bornes de recharge',
  load: async () => { throw new Error('Bloc en préparation'); },
};
