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

  return () => {
    supabase.removeChannel(itemsChannel);
    supabase.removeChannel(articlesChannel);
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}