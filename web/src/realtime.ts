import { supabase } from './shims/supabaseClient';
import { db } from './storage/db';
import type { Block, Article } from './types';

type ChangePayload = any; // minimal typing

function isoToMs(iso?: string) { if (!iso) return 0; const t = Date.parse(iso); return Number.isNaN(t)?0:t; }

export function initRealtime(userId: string, onRemoteChange: ()=>void) {
  let changed = false;
  let debounceTimer: any;
  const schedule = () => {
    changed = true;
    if (debounceTimer) return;
    debounceTimer = setTimeout(()=> { if (changed) { changed = false; onRemoteChange(); } debounceTimer = null; }, 500);
  };

  const itemsChannel = supabase.channel('realtime:public:items')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: `user_id=eq.${userId}` }, async (payload: ChangePayload) => {
      const row = (payload.new || payload.old) as any;
      if (!row?.id) return;
      const remoteTs = isoToMs(row.updated_at);
      if (payload.eventType === 'DELETE' || row.deleted) {
        await db.items.delete(row.id);
        schedule();
        return;
      }
      const local = await db.items.get(row.id);
      const localTs = local?.updatedAt || 0;
      if (!local || remoteTs > localTs) {
        const block: Block = { id: row.id, text: row.text, lang: row.lang, kind: row.kind, box: row.box, position: row.position, updatedAt: remoteTs, deleted: row.deleted };
        await db.items.put(block);
        schedule();
      }
    })
    .subscribe();

  const articlesChannel = supabase.channel('realtime:public:articles')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'articles', filter: `user_id=eq.${userId}` }, async (payload: ChangePayload) => {
      const row = (payload.new || payload.old) as any;
      if (!row?.id) return;
      const remoteTs = isoToMs(row.updated_at);
      if (payload.eventType === 'DELETE' || row.deleted) {
        await db.articles.delete(row.id);
        schedule();
        return;
      }
      const local = await db.articles.get(row.id);
      const localTs = local?.updatedAt || 0;
      if (!local || remoteTs > localTs) {
        const art: Article = { id: row.id, createdAt: isoToMs(row.created_at) || Date.now(), lang: row.lang, raw: row.raw, html: row.html, usedBlockIds: row.used_block_ids || [], updatedAt: remoteTs, deleted: row.deleted };
        await db.articles.put(art);
        schedule();
      }
    })
    .subscribe();

  // unread_articles realtime
  const unreadChannel = supabase.channel('realtime:public:unread_articles')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'unread_articles', filter: `user_id=eq.${userId}` }, async (payload: ChangePayload) => {
      const row = (payload.new || payload.old) as any;
      if (!row?.id) return;
      const remoteTs = isoToMs(row.updated_at);
      if (payload.eventType === 'DELETE' || row.deleted) {
        await db.unreadArticles.delete(row.id);
        schedule();
        return;
      }
      const local = await db.unreadArticles.get(row.id);
      const localTs = local?.updatedAt || 0;
      if (!local || remoteTs > localTs) {
        const art: Article = { id: row.id, createdAt: isoToMs(row.created_at) || Date.now(), lang: row.lang, raw: row.raw, html: row.html, usedBlockIds: row.used_block_ids || [], updatedAt: remoteTs, deleted: row.deleted };
        await db.unreadArticles.put(art);
        schedule();
      }
    })
    .subscribe();

  // magic_items realtime
  const magicChannel = supabase.channel('realtime:public:magic_items')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'magic_items', filter: `user_id=eq.${userId}` }, async (payload: ChangePayload) => {
      const row = (payload.new || payload.old) as any;
      if (!row?.id) return;
      const remoteTs = isoToMs(row.updated_at);
      if (payload.eventType === 'DELETE' || row.deleted) {
        await db.magicItems.delete(row.id);
        schedule();
        return;
      }
      const local = await db.magicItems.get(row.id);
      const localTs = local?.updatedAt || 0;
      if (!local || remoteTs > localTs) {
        const magic = { id: row.id, sourceBlockId: row.source_block_id, text: row.text, lang: row.lang, box: row.box, addedAt: isoToMs(row.added_at) || Date.now(), copied: row.copied, updatedAt: remoteTs, deleted: row.deleted };
        await db.magicItems.put(magic);
        schedule();
      }
    })
    .subscribe();

  // user_settings realtime (單行，更新時同步到本地 settings key)
  const settingsChannel = supabase.channel('realtime:public:user_settings')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_settings', filter: `user_id=eq.${userId}` }, async (payload: ChangePayload) => {
      const row = (payload.new || payload.old) as any;
      if (!row) return;
      const remoteTs = isoToMs(row.updated_at);
      const local = await db.settings.get('settings');
      const localTs = local?.updatedAt || 0;
      if (!local || remoteTs > localTs) {
        await db.settings.put({ key: 'settings', value: row.data || {}, updatedAt: remoteTs });
        schedule();
      }
    })
    .subscribe();

  return () => {
    supabase.removeChannel(itemsChannel);
    supabase.removeChannel(articlesChannel);
    supabase.removeChannel(unreadChannel);
    supabase.removeChannel(magicChannel);
  supabase.removeChannel(settingsChannel);
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}