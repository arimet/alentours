import type { Block } from '../lib/block';

export const ecoles: Block = {
  id: 'ecoles',
  title: 'Écoles',
  load: async () => { throw new Error('Bloc en préparation'); },
};
