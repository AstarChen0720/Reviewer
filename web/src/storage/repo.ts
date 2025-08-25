import { db } from './db';
import type { Block, Box, Article } from '../types';

// --------------------
// Migration from legacy localStorage keys to IndexedDB (one-time)
// --------------------
const LEGACY_MIGRATION_FLAG = 'reviewer.migrated.localstorage.v1';
const legacyKeys = {
  readerConfig: 'reviewer.reader.config.v1',
  magicBag: 'reviewer.magicBag.v1',
  magicFilter: 'reviewer.magicBag.filter',
  magicOrder: 'reviewer.magicBag.order',
  magicIncludeCopied: 'reviewer.magicBag.includeCopied',
  genHistory: 'reviewer.gen.history',
  batchState: 'reviewer.batch.v1',
  currentArticle: 'reviewer.currentArticle.v1',
  lastLang: 'reviewer.lastLang',
  loadLang: 'reviewer.loadLang',
  geminiApiKey: 'reviewer.gemini.apiKey',
  geminiModel: 'reviewer.gemini.model'
} as const;

export async function runLocalStorageMigrationOnce() {
  if (localStorage.getItem(LEGACY_MIGRATION_FLAG)) return;
  try {
    // settings table: readerConfig, language prefs, gemini model (NOT api key for security decision; we move but still keep local removal optional)
    const settings: Record<string, any> = {};
    const readerConfigRaw = localStorage.getItem(legacyKeys.readerConfig);
    if (readerConfigRaw) {
      try { settings.readerConfig = JSON.parse(readerConfigRaw); } catch {}
    }
    const geminiModel = localStorage.getItem(legacyKeys.geminiModel);
    if (geminiModel) settings.geminiModel = geminiModel;
    const lastLang = localStorage.getItem(legacyKeys.lastLang);
    if (lastLang) settings.lastLang = lastLang;
    const loadLang = localStorage.getItem(legacyKeys.loadLang);
    if (loadLang) settings.loadLang = loadLang;
    const magicFilter = localStorage.getItem(legacyKeys.magicFilter);
    if (magicFilter) settings.magicFilter = magicFilter;
    const magicOrder = localStorage.getItem(legacyKeys.magicOrder);
    if (magicOrder) settings.magicOrder = magicOrder;
    const magicIncludeCopied = localStorage.getItem(legacyKeys.magicIncludeCopied);
    if (magicIncludeCopied) settings.magicIncludeCopied = magicIncludeCopied;
    if (Object.keys(settings).length) {
      await db.settings.put({ key: 'settings', value: settings, updatedAt: Date.now() });
    }
    // magic bag
    const magicBagRaw = localStorage.getItem(legacyKeys.magicBag);
    if (magicBagRaw) {
      try {
        const arr = JSON.parse(magicBagRaw);
        if (Array.isArray(arr)) {
          const rows = arr.map((m: any) => ({ ...m, addedAt: m.addedAt || Date.now() }));
          if (rows.length) await db.magicItems.bulkPut(rows);
        }
      } catch {}
    }
    // states: batch state, current article, generation history
    const batchRaw = localStorage.getItem(legacyKeys.batchState);
    if (batchRaw) await db.states.put({ key: 'batch', value: batchRaw, updatedAt: Date.now() });
    const currentArticleRaw = localStorage.getItem(legacyKeys.currentArticle);
    if (currentArticleRaw) await db.states.put({ key: 'currentArticle', value: currentArticleRaw, updatedAt: Date.now() });
    const genHistoryRaw = localStorage.getItem(legacyKeys.genHistory);
    if (genHistoryRaw) await db.states.put({ key: 'genHistory', value: genHistoryRaw, updatedAt: Date.now() });
    // gemini api key: store encrypted? For now we keep in localStorage; copy to states only if user opted-in (not implemented)
  } finally {
    localStorage.setItem(LEGACY_MIGRATION_FLAG, '1');
  }
}

// Utility accessors for new tables
export async function loadSettings(): Promise<any> {
  const row = await db.settings.get('settings');
  return row?.value || {};
}
export async function saveSettings(partial: Record<string, any>) {
  const cur = await loadSettings();
  const next = { ...cur, ...partial };
  await db.settings.put({ key: 'settings', value: next, updatedAt: Date.now() });
  return next;
}

export type MagicItem = { id: string; sourceBlockId: string; text: string; lang: Block['lang']; box: Block['box']; addedAt: number; copied?: boolean };
export async function listMagicItems(): Promise<MagicItem[]> { return db.magicItems.orderBy('addedAt').reverse().toArray(); }
export async function putMagicItem(item: MagicItem) { await db.magicItems.put(item); }
export async function putMagicItems(items: MagicItem[]) { if (items.length) await db.magicItems.bulkPut(items); }
export async function removeMagicItem(id: string) { await db.magicItems.delete(id); }
export async function clearMagicItems() { await db.magicItems.clear(); }

export async function getState(key: string): Promise<string | undefined> { const row = await db.states.get(key); return row?.value; }
export async function setState(key: string, value: string) { await db.states.put({ key, value, updatedAt: Date.now() }); }
export async function deleteState(key: string) { await db.states.delete(key); }

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
