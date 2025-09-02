import { db } from './db';
import type { Block, Box, Article } from '../types';
import { schedulePush } from './sync';

// --------------------
// Dirty queue (localStorage) for sync
// --------------------
type DirtyKinds = 'items' | 'articles' | 'unreadArticles' | 'settings' | 'magicItems' | 'states';
function getDirty(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem('reviewer.sync.dirty') || '{}'); } catch { return {}; }
}
function setDirty(obj: Record<string,string[]>) {
  localStorage.setItem('reviewer.sync.dirty', JSON.stringify(obj));
}
function markDirty(kind: DirtyKinds, ids: string[]) {
  if (!ids.length) return;
  const cur = getDirty();
  cur[kind] = Array.from(new Set([...(cur[kind]||[]), ...ids]));
  setDirty(cur);
  // debounce auto push
  schedulePush();
}

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
  markDirty('settings', ['settings']);
  return next;
}

export type MagicItem = { id: string; sourceBlockId: string; text: string; lang: Block['lang']; box: Block['box']; addedAt: number; copied?: boolean };
export async function listMagicItems(): Promise<MagicItem[]> { return (await db.magicItems.orderBy('addedAt').reverse().toArray()).filter(m=>!m.deleted); }
export async function putMagicItem(item: MagicItem) { await db.magicItems.put({ ...item, deleted: false }); markDirty('magicItems', [item.id]); }
export async function putMagicItems(items: MagicItem[]) { if (items.length) { await db.magicItems.bulkPut(items.map(i=>({ ...i, deleted:false }))); markDirty('magicItems', items.map(i=>i.id)); } }
export async function removeMagicItem(id: string) { const m = await db.magicItems.get(id); if (!m) return; m.deleted = true; m.updatedAt = Date.now(); await db.magicItems.put(m); markDirty('magicItems', [id]); }
export async function clearMagicItems() { const all = await db.magicItems.toArray(); for (const m of all) { if (!m.deleted) { m.deleted = true; m.updatedAt = Date.now(); await db.magicItems.put(m); } } markDirty('magicItems', all.map(m=>m.id)); }

export async function getState(key: string): Promise<string | undefined> { const row = await db.states.get(key); return row?.value; }
export async function setState(key: string, value: string) { await db.states.put({ key, value, updatedAt: Date.now() }); }
export async function deleteState(key: string) { await db.states.delete(key); }

export async function getAllByBox(): Promise<Record<Box, Block[]>> {
  const all = (await db.items.toArray()).filter(b=>!b.deleted);
  const by: Record<Box, Block[]> = { stash: [], box1: [], box2: [], box3: [], trash: [] };
  for (const b of all) by[b.box].push(b);
  for (const k of Object.keys(by) as Box[]) by[k].sort((a, b) => a.position - b.position);
  return by;
}

export async function bulkAdd(blocks: Block[]) {
  const ts = Date.now();
  blocks.forEach(b => { if (!b.updatedAt) b.updatedAt = ts; });
  await db.items.bulkAdd(blocks);
  markDirty('items', blocks.map(b=>b.id));
}

export async function upsert(block: Block) {
  const updated = { ...block, updatedAt: Date.now() };
  await db.items.put(updated);
  markDirty('items', [updated.id]);
}

export async function remove(id: string) {
  const row = await db.items.get(id);
  if (!row) return;
  row.deleted = true; row.updatedAt = Date.now();
  await db.items.put(row); markDirty('items', [id]);
}

export async function clearAll() {
  const all = await db.items.toArray();
  for (const it of all) { if (!it.deleted) { it.deleted = true; it.updatedAt = Date.now(); await db.items.put(it); } }
  markDirty('items', all.map(i=>i.id));
}

// Articles
export async function saveArticle(article: Article) {
  const updated = { ...article, updatedAt: Date.now() };
  await db.articles.put(updated);
  markDirty('articles', [updated.id]);
}

export async function listArticles(limit = 20): Promise<Article[]> {
  return (await db.articles.orderBy('createdAt').reverse().limit(limit).toArray()).filter(a=>!a.deleted);
}

export async function getArticle(id: string): Promise<Article | undefined> { const a = await db.articles.get(id); if (a?.deleted) return undefined; return a; }

export async function trimOldArticles(max = 15) {
  const rows = await db.articles.orderBy('createdAt').toArray();
  const live = rows.filter(r=>!r.deleted);
  if (live.length <= max) return;
  const extra = live.length - max;
  const olds = live.slice(0, extra);
  for (const a of olds) { a.deleted = true; a.updatedAt = Date.now(); await db.articles.put(a); markDirty('articles', [a.id]); }
}

export async function deleteArticle(id: string) { const a = await db.articles.get(id); if (!a) return; a.deleted = true; a.updatedAt = Date.now(); await db.articles.put(a); markDirty('articles', [id]); }

export async function deleteArticles(ids: string[]) { if (!ids.length) return; for (const id of ids) { const a = await db.articles.get(id); if (a) { a.deleted = true; a.updatedAt = Date.now(); await db.articles.put(a); } } markDirty('articles', ids); }

export async function clearAllArticles() { const all = await db.articles.toArray(); for (const a of all) { if (!a.deleted) { a.deleted = true; a.updatedAt = Date.now(); await db.articles.put(a); } } markDirty('articles', all.map(a=>a.id)); }

// Unread Articles (AI generated, not yet formally saved by user)
export async function saveUnreadArticle(article: Article) {
  const updated = { ...article, updatedAt: Date.now() };
  await db.unreadArticles.put(updated);
  markDirty('unreadArticles', [updated.id]);
}

export async function listUnreadArticles(limit = 50): Promise<Article[]> { return (await db.unreadArticles.orderBy('createdAt').reverse().limit(limit).toArray()).filter(a=>!a.deleted); }

export async function getUnreadArticle(id: string): Promise<Article | undefined> { const a = await db.unreadArticles.get(id); if (a?.deleted) return undefined; return a; }

export async function deleteUnreadArticle(id: string) { const a = await db.unreadArticles.get(id); if (!a) return; a.deleted = true; a.updatedAt = Date.now(); await db.unreadArticles.put(a); markDirty('unreadArticles', [id]); }

export async function deleteUnreadArticles(ids: string[]) { if (!ids.length) return; for (const id of ids) { const a = await db.unreadArticles.get(id); if (a) { a.deleted = true; a.updatedAt = Date.now(); await db.unreadArticles.put(a); } } markDirty('unreadArticles', ids); }

export async function clearAllUnreadArticles() { const all = await db.unreadArticles.toArray(); for (const a of all) { if (!a.deleted) { a.deleted = true; a.updatedAt = Date.now(); await db.unreadArticles.put(a); } } markDirty('unreadArticles', all.map(a=>a.id)); }

// --------------------
// Multi-user isolation helper: wipe ALL local data (used when切換帳號)
// --------------------
export async function wipeAllLocalData() {
  // 清空 Dexie 資料表
  await Promise.all([
    db.items.clear(),
    db.articles.clear(),
    db.unreadArticles.clear(),
    db.settings.clear(),
    db.magicItems.clear(),
    db.states.clear()
  ]).catch(()=>{});
  // 清空同步/髒資料佇列
  try {
    localStorage.removeItem('reviewer.sync.dirty');
    localStorage.removeItem('reviewer.sync.meta');
  } catch {}
}
