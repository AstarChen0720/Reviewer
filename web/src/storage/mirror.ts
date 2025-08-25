import { db } from './db';
import { saveSettings, setState, putMagicItems } from './repo';

// Keys to mirror from localStorage into IndexedDB. This provides a transitional
// layer so existing components that still directly read/write localStorage
// automatically persist to Dexie without needing invasive refactors.

const MAGIC_BAG_KEY = 'reviewer.magicBag.v1';
const SETTINGS_KEYS = [
  'reviewer.reader.config.v1',
  'reviewer.magicBag.filter',
  'reviewer.magicBag.order',
  'reviewer.magicBag.includeCopied',
  'reviewer.lastLang',
  'reviewer.loadLang',
  'reviewer.gemini.model',
  'reviewer.gemini.apiKey'
];
const STATE_KEYS = [
  'reviewer.gen.history',
  'reviewer.batch.v1',
  'reviewer.currentArticle.v1'
];

let started = false;

export function startLocalStorageDexieMirror() {
  if (started) return; started = true;
  // Initial sync
  syncAll().catch(()=>{});
  // Monkey patch setItem/removeItem for realtime mirroring
  try {
    const origSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(k: string, v: string) {
      origSet(k, v); mirrorKey(k, v).catch(()=>{}); } as any;
    const origRemove = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = function(k: string) { origRemove(k); mirrorKey(k, null).catch(()=>{}); } as any;
  } catch {}
  // Also listen storage events from other tabs
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    mirrorKey(e.key, e.newValue).catch(()=>{});
  });
}

async function syncAll() {
  for (const k of [MAGIC_BAG_KEY, ...SETTINGS_KEYS, ...STATE_KEYS]) {
    const v = localStorage.getItem(k);
    await mirrorKey(k, v);
  }
}

async function mirrorKey(key: string, value: string | null) {
  try {
    if (key === MAGIC_BAG_KEY) {
      if (!value) { await db.magicItems.clear(); return; }
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) {
        await db.magicItems.clear();
        await putMagicItems(arr);
      }
      return;
    }
    if (SETTINGS_KEYS.includes(key)) {
      const partial: any = {};
      switch(key) {
        case 'reviewer.reader.config.v1':
          if (value) { try { partial.readerConfig = JSON.parse(value); } catch {} }
          break;
        case 'reviewer.magicBag.filter': partial.magicFilter = value || 'all'; break;
        case 'reviewer.magicBag.order': partial.magicOrder = value || 'newest'; break;
        case 'reviewer.magicBag.includeCopied': partial.magicIncludeCopied = value || '1'; break;
        case 'reviewer.lastLang': partial.lastLang = value; break;
        case 'reviewer.loadLang': partial.loadLang = value; break;
        case 'reviewer.gemini.model': partial.geminiModel = value; break;
        case 'reviewer.gemini.apiKey': partial.geminiApiKey = value; break;
      }
      if (Object.keys(partial).length) await saveSettings(partial);
      return;
    }
    if (STATE_KEYS.includes(key)) {
      await setState(key, value || '');
    }
  } catch {
    // ignore
  }
}
