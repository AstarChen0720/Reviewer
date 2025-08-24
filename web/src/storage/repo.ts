import { db } from './db';
import type { Block, Box, Article } from '../types';

export async function getAllByBox(): Promise<Record<Box, Block[]>> {
  const all = await db.items.toArray();
  const by: Record<Box, Block[]> = { stash: [], box1: [], box2: [], box3: [], trash: [] };
  for (const b of all) by[b.box].push(b);
  for (const k of Object.keys(by) as Box[]) by[k].sort((a, b) => a.position - b.position);
  return by;
}

export async function bulkAdd(blocks: Block[]) {
  await db.items.bulkAdd(blocks);
}

export async function upsert(block: Block) {
  await db.items.put(block);
}

export async function remove(id: string) {
  await db.items.delete(id);
}

export async function clearAll() {
  await db.items.clear();
}

// Articles
export async function saveArticle(article: Article) {
  await db.articles.put(article);
}

export async function listArticles(limit = 20): Promise<Article[]> {
  return db.articles.orderBy('createdAt').reverse().limit(limit).toArray();
}

export async function getArticle(id: string): Promise<Article | undefined> {
  return db.articles.get(id);
}

export async function trimOldArticles(max = 15) {
  const count = await db.articles.count();
  if (count <= max) return;
  const extra = count - max;
  const olds = await db.articles.orderBy('createdAt').limit(extra).toArray();
  await db.articles.bulkDelete(olds.map(a => a.id));
}

export async function deleteArticle(id: string) {
  await db.articles.delete(id);
}

export async function deleteArticles(ids: string[]) {
  if (!ids.length) return;
  await db.articles.bulkDelete(ids);
}

export async function clearAllArticles() {
  await db.articles.clear();
}

// Unread Articles (AI generated, not yet formally saved by user)
export async function saveUnreadArticle(article: Article) {
  await db.unreadArticles.put(article);
}

export async function listUnreadArticles(limit = 50): Promise<Article[]> {
  return db.unreadArticles.orderBy('createdAt').reverse().limit(limit).toArray();
}

export async function getUnreadArticle(id: string): Promise<Article | undefined> {
  return db.unreadArticles.get(id);
}

export async function deleteUnreadArticle(id: string) {
  await db.unreadArticles.delete(id);
}

export async function deleteUnreadArticles(ids: string[]) {
  if (!ids.length) return;
  await db.unreadArticles.bulkDelete(ids);
}

export async function clearAllUnreadArticles() {
  await db.unreadArticles.clear();
}
