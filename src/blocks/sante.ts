import type { Block } from '../lib/block';

export const sante: Block = {
  id: 'sante',
  title: 'Santé',
  load: async () => { throw new Error('Bloc en préparation'); },
};
