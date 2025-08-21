import type { Block } from "../types";

const KEY = "reviewer.blocks.v1";

export function load(): Block[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function save(blocks: Block[]) {
  localStorage.setItem(KEY, JSON.stringify(blocks));
}
