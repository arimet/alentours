import type { Block } from '../lib/block';

export const risques: Block = {
  id: 'risques',
  title: 'Risques',
  load: async () => { throw new Error('Bloc en préparation'); },
};
