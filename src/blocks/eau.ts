import type { Block } from '../lib/block';

export const eau: Block = {
  id: 'eau',
  title: 'Eau du robinet',
  load: async () => { throw new Error('Bloc en préparation'); },
};
