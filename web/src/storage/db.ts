import Dexie, { type Table } from 'dexie';
import type { Block } from '../types';

export class ReviewerDB extends Dexie {
  items!: Table<Block, string>;
  constructor() {
    super('reviewer');
    this.version(1).stores({
      // primary key id, indexes on box and position for quick queries
      items: 'id, box, position'
    });
  }
}

export const db = new ReviewerDB();
