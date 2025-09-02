import { supabase } from '../shims/supabaseClient';
import { db } from './db';
import type { Block, Article } from '../types';

export const syncState = {
  pushing: false,
  pulling: false,
  error: '' as string | undefined,
  lastPush: 0,
  lastPull: 0
};

function loadMeta() {
  try { return JSON.parse(localStorage.getItem('reviewer.sync.meta')||'{}'); } catch { return {}; }
}
function saveMeta(meta: any) { localStorage.setItem('reviewer.sync.meta', JSON.stringify(meta)); }
function getDirty(): Record<string,string[]> { try { return JSON.parse(localStorage.getItem('reviewer.sync.dirty')||'{}'); } catch { return {}; } }
function clearDirty(kind: string, ids: string[]) {
  try {
    const cur = getDirty();
    if (!cur[kind]) return;
    cur[kind] = cur[kind].filter(id => !ids.includes(id));
    localStorage.setItem('reviewer.sync.dirty', JSON.stringify(cur));
  } catch {}
}

export async function pushAll() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('未登入');
  const dirty = getDirty();
  if (!Object.keys(dirty).length) return;
  syncState.pushing = true; syncState.error = undefined;
  try {
  if (dirty.items?.length) {
      const rows = await db.items.bulkGet(dirty.items);
      const payload = rows.filter(Boolean).map(r => ({
        id: r!.id,
        user_id: user.id,
        text: r!.text,
        lang: r!.lang,
        kind: r!.kind,
        box: r!.box,
        position: r!.position,
        updated_at: new Date(r!.updatedAt || Date.now()).toISOString(),
    deleted: !!r!.deleted
      }));
      if (payload.length) {
        const { error } = await supabase.from('items').upsert(payload);
        if (error) throw error;
      }
      clearDirty('items', dirty.items);
    }
  if (dirty.articles?.length) {
      const rows = await db.articles.bulkGet(dirty.articles);
      const payload = rows.filter(Boolean).map(r => ({
        id: r!.id,
        user_id: user.id,
        lang: r!.lang,
        raw: r!.raw,
        html: r!.html,
        used_block_ids: r!.usedBlockIds,
        created_at: new Date(r!.createdAt).toISOString(),
        updated_at: new Date(r!.updatedAt || Date.now()).toISOString(),
    deleted: !!r!.deleted
      }));
      if (payload.length) {
        const { error } = await supabase.from('articles').upsert(payload);
        if (error) throw error;
      }
      clearDirty('articles', dirty.articles);
    }
    // unread_articles
  if (dirty.unreadArticles?.length) {
      const rows = await db.unreadArticles.bulkGet(dirty.unreadArticles);
      const payload = rows.filter(Boolean).map(r => ({
        id: r!.id,
        user_id: user.id,
        lang: r!.lang,
        raw: r!.raw,
        html: r!.html,
        used_block_ids: r!.usedBlockIds,
        created_at: new Date(r!.createdAt).toISOString(),
        updated_at: new Date(r!.updatedAt || Date.now()).toISOString(),
    deleted: !!r!.deleted
      }));
      if (payload.length) {
        const { error } = await supabase.from('unread_articles').upsert(payload);
        if (error) throw error;
      }
      clearDirty('unreadArticles', dirty.unreadArticles);
    }
    // magic_items (全部推：簡單處理，可再優化為 dirty)
  if (dirty.magicItems?.length) {
      const rows = await db.magicItems.bulkGet(dirty.magicItems);
      const payload = rows.filter(Boolean).map(r => ({
        id: r!.id,
        user_id: user.id,
        source_block_id: r!.sourceBlockId,
        text: r!.text,
        lang: r!.lang,
        box: r!.box,
        added_at: new Date(r!.addedAt).toISOString(),
        copied: !!r!.copied,
        updated_at: new Date(r!.updatedAt || Date.now()).toISOString(),
    deleted: !!r!.deleted
      }));
      if (payload.length) {
        const { error } = await supabase.from('magic_items').upsert(payload);
        if (error) throw error;
      }
      clearDirty('magicItems', dirty.magicItems);
    }
    // user_settings (單一 row)
    if (dirty.settings?.length) {
      const settingsRow = await db.settings.get('settings');
      if (settingsRow) {
        const { error } = await supabase.from('user_settings').upsert({
          user_id: user.id,
          data: settingsRow.value,
          updated_at: new Date(settingsRow.updatedAt || Date.now()).toISOString()
        });
        if (error) throw error;
      }
      clearDirty('settings', dirty.settings);
    }
    const meta = loadMeta(); meta.lastPush = Date.now(); saveMeta(meta); syncState.lastPush = meta.lastPush;
  } catch (e:any) {
    syncState.error = e.message || String(e);
    throw e;
  } finally { syncState.pushing = false; }
}

export async function pullAll(full = false) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('未登入');
  const meta = loadMeta();
  const sinceIso = !full && meta.lastPull ? new Date(meta.lastPull).toISOString() : null;
  syncState.pulling = true; syncState.error = undefined;
  try {
    // items
    let q = supabase.from('items').select('*').eq('user_id', user.id);
    if (sinceIso) q = q.gte('updated_at', sinceIso);
    const { data: items, error: e1 } = await q;
    if (e1) throw e1;
    if (items?.length) {
      for (const r of items) {
        const local = await db.items.get(r.id);
        const remoteTs = Date.parse(r.updated_at);
        const localTs = local?.updatedAt || 0;
        if (!local || remoteTs > localTs) {
          if (r.deleted) { if (local) await db.items.delete(r.id); continue; }
          const block: Block = { id: r.id, text: r.text, lang: r.lang, kind: r.kind, box: r.box, position: r.position, updatedAt: remoteTs, deleted: r.deleted };
          await db.items.put(block);
        }
      }
    }
  // articles
    let qa = supabase.from('articles').select('*').eq('user_id', user.id);
    if (sinceIso) qa = qa.gte('updated_at', sinceIso);
    const { data: arts, error: e2 } = await qa;
    if (e2) throw e2;
    if (arts?.length) {
      for (const r of arts) {
        const local = await db.articles.get(r.id);
        const remoteTs = Date.parse(r.updated_at);
        const localTs = local?.updatedAt || 0;
        if (!local || remoteTs > localTs) {
          if (r.deleted) { if (local) await db.articles.delete(r.id); continue; }
          const art: Article = { id: r.id, createdAt: Date.parse(r.created_at), lang: r.lang, raw: r.raw, html: r.html, usedBlockIds: r.used_block_ids || [], updatedAt: remoteTs, deleted: r.deleted };
            await db.articles.put(art);
        }
      }
    }
    // unread_articles
    let qu = supabase.from('unread_articles').select('*').eq('user_id', user.id);
    if (sinceIso) qu = qu.gte('updated_at', sinceIso);
    const { data: unread, error: e3 } = await qu;
    if (e3) throw e3;
    if (unread?.length) {
      for (const r of unread) {
        const local = await db.unreadArticles.get(r.id);
        const remoteTs = Date.parse(r.updated_at);
        const localTs = local?.updatedAt || 0;
        if (!local || remoteTs > localTs) {
          if (r.deleted) { if (local) await db.unreadArticles.delete(r.id); continue; }
          const art: Article = { id: r.id, createdAt: Date.parse(r.created_at), lang: r.lang, raw: r.raw, html: r.html, usedBlockIds: r.used_block_ids || [], updatedAt: remoteTs, deleted: r.deleted };
          await db.unreadArticles.put(art);
        }
      }
    }
    // magic_items
    let qm = supabase.from('magic_items').select('*').eq('user_id', user.id);
    if (sinceIso) qm = qm.gte('updated_at', sinceIso);
    const { data: magics, error: e4 } = await qm;
    if (e4) throw e4;
    if (magics?.length) {
      for (const r of magics) {
        const local = await db.magicItems.get(r.id);
        const remoteTs = Date.parse(r.updated_at);
        const localTs = local?.updatedAt || 0;
        if (!local || remoteTs > localTs) {
          if (r.deleted) { if (local) await db.magicItems.delete(r.id); continue; }
          const row = { id: r.id, sourceBlockId: r.source_block_id, text: r.text, lang: r.lang, box: r.box, addedAt: Date.parse(r.added_at)||Date.now(), copied: r.copied, updatedAt: remoteTs, deleted: r.deleted };
          await db.magicItems.put(row);
        }
      }
    }
    // user_settings
    const { data: settingsRows, error: e5 } = await supabase.from('user_settings').select('*').eq('user_id', user.id).limit(1);
    if (e5) throw e5;
    if (settingsRows && settingsRows.length) {
      const s = settingsRows[0];
      const local = await db.settings.get('settings');
      const remoteTs = Date.parse(s.updated_at);
      const localTs = local?.updatedAt || 0;
      if (!local || remoteTs > localTs) {
        await db.settings.put({ key: 'settings', value: s.data || {}, updatedAt: remoteTs });
      }
    }
    const meta2 = loadMeta(); meta2.lastPull = Date.now(); saveMeta(meta2); syncState.lastPull = meta2.lastPull;
  } catch (e:any) { syncState.error = e.message || String(e); throw e; } finally { syncState.pulling = false; }
}

export async function syncAll() { await pushAll(); await pullAll(); }

// -----------------
// Auto push (debounced) when local dirty changes occur
// -----------------
let pushTimer: any;
export function schedulePush(delay = 1200) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // not logged in
      // don't start if a push is already running
      if (syncState.pushing) return;
      await pushAll();
    } catch { /* swallow */ }
  }, delay);
}