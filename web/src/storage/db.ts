import Dexie, { type Table } from 'dexie';
import type { Block, Article } from '../types';

export class ReviewerDB extends Dexie {
  items!: Table<Block, string>;
  articles!: Table<Article, string>;
  unreadArticles!: Table<Article, string>;
  settings!: Table<any, string>; // key-value settings (reader config, etc.)
  magicItems!: Table<any, string>; // magic bag items
  states!: Table<any, string>; // transient states like batch, current article, history
  constructor() {
    super('reviewer');
    this.version(1).stores({
      items: 'id, box, position'
    });
    this.version(2).stores({
      items: 'id, box, position',
      articles: 'id, createdAt'
    });
    // v3: add unreadArticles table for AI generated but not yet saved articles
    this.version(3).stores({
      items: 'id, box, position',
      articles: 'id, createdAt',
      unreadArticles: 'id, createdAt'
    });
    // v4: add settings, magicItems, states (key-value tables)
    this.version(4).stores({
      items: 'id, box, position',
      articles: 'id, createdAt',
      unreadArticles: 'id, createdAt',
      settings: 'key',
      magicItems: 'id, addedAt',
      states: 'key'
    });
  }
}

export const db = new ReviewerDB();
