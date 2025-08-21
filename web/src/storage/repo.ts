import { db } from './db';
import type { Block, Box } from '../types';

export async function getAllByBox(): Promise<Record<Box, Block[]>> {
  const all = await db.items.toArray();
  const by: Record<Box, Block[]> = { stash: [], box1: [], box2: [], box3: [] };
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
