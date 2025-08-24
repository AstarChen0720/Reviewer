import Dexie, { type Table } from 'dexie';
import type { Block, Article } from '../types';

export class ReviewerDB extends Dexie {
  items!: Table<Block, string>;
  articles!: Table<Article, string>;
  constructor() {
    super('reviewer');
    this.version(1).stores({
      items: 'id, box, position'
    });
    this.version(2).stores({
      items: 'id, box, position',
      articles: 'id, createdAt'
    });
  }
}

export const db = new ReviewerDB();
