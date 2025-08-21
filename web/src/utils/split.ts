import type { Block } from '../types';

export function uuid() {
  return crypto.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}

export function detectLang(s: string): Block['lang'] {
  if (/[ぁ-んァ-ン一-龯]/.test(s)) return 'ja';
  if (/[a-zA-Z]/.test(s)) return 'en';
  return 'unknown';
}

export function guessKind(s: string): Block['kind'] {
  if (s.split(/\s+/).length >= 3) return 'grammar';
  if (s.length <= 30) return 'vocab';
  return 'unknown';
}

type SplitMode = 'auto' | 'line' | 'sentence' | 'separator';

function splitByLine(raw: string): string[] {
  return raw.split(/\r?\n+/).map(s => s.trim()).filter(Boolean);
}

function splitBySentence(raw: string): string[] {
  // 在句號/問號/驚嘆號（含中日文變體）後面斷句
  const injected = raw.replace(/([。．\.！!？\?]+)\s*/g, '$1\n');
  return injected.split(/\r?\n+/).map(s => s.trim()).filter(Boolean);
}

function splitBySeparator(raw: string): string[] {
  // 以常見分隔符號切（、，,；; ／/ |）；若仍只有一段且有空白，最後以空白切
  let parts = raw.split(/[、，,；;\/\|]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1 && /\s/.test(raw)) {
    parts = raw.split(/\s+/).map(s => s.trim()).filter(Boolean);
  }
  return parts;
}

export function splitToBlocks(raw: string, mode: SplitMode = 'auto'): Block[] {
  const text = (raw ?? '').trim();
  if (!text) return [];

  let pieces: string[] = [];
  if (mode === 'line') pieces = splitByLine(text);
  else if (mode === 'sentence') pieces = splitBySentence(text);
  else if (mode === 'separator') pieces = splitBySeparator(text);
  else {
    // auto：先試換行 → 句子 → 分隔符
    pieces = splitByLine(text);
    if (pieces.length <= 1) pieces = splitBySentence(text);
    if (pieces.length <= 1) pieces = splitBySeparator(text);
  }

  return pieces.map((t, i) => ({
    id: uuid(),
    text: t,
    lang: detectLang(t),
    kind: guessKind(t),
    box: 'stash',
    position: i,
  }));
}