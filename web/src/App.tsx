import { useEffect, useMemo, useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { DropZone } from './components/DropZone';
import { TrashBin } from './components/TrashBin';
import { DraggableItem } from './components/DraggableItem';
import type { Block, Box } from './types';
import { splitToBlocks } from './utils/split';
import { db } from './storage/db';
import { getAllByBox, bulkAdd, upsert, remove, clearAll as clearAllDB } from './storage/repo';
import { Reader } from './components/Reader';

const boxes: Box[] = ['stash', 'box1', 'box2', 'box3'];
export const boxLabels: Record<Box, string> = {
  stash: '暫存',
  box1: '沒印象',
  box2: '不熟',
  box3: '熟悉',
};

export default function App() {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'auto'|'line'|'sentence'|'separator'>('auto');
  const [view, setView] = useState<'board'|'reader'>('board');
  const [blocks, setBlocks] = useState<Block[]>([]);

  // 初始讀取：先嘗試把 localStorage 舊資料搬到 Dexie（一次性）
  useEffect(() => {
    (async () => {
      const hasAny = await db.items.count();
      if (hasAny === 0) {
        try {
          const raw = localStorage.getItem('reviewer.blocks.v1');
          if (raw) {
            const arr = JSON.parse(raw) as Block[];
            if (Array.isArray(arr) && arr.length) await bulkAdd(arr);
            // 移除舊資料避免下次重覆匯入
            localStorage.removeItem('reviewer.blocks.v1');
          }
        } catch {}
      }
      const grouped = await getAllByBox();
      setBlocks([ ...grouped.stash, ...grouped.box1, ...grouped.box2, ...grouped.box3 ]);
    })();
  }, []);

  const byBox = useMemo(() => {
    const map: Record<Box, Block[]> = { stash: [], box1: [], box2: [], box3: [] };
    for (const b of blocks) map[b.box].push(b);
    for (const k of boxes) map[k].sort((a, b) => a.position - b.position);
    return map;
  }, [blocks]);

  function addFromText() {
    if (!text.trim()) return;
    const base = byBox.stash.length;
    const newBlocks = splitToBlocks(text, mode).map((b, i) => ({ ...b, position: base + i }));
    setBlocks(prev => [...prev, ...newBlocks]);
    // 寫入 DB
    void bulkAdd(newBlocks);
    setText('');
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over?.id?.toString(); // 可能是 'trash'、容器 id 或項目 id
    if (!overId) return;

    if (overId === 'trash') {
      setBlocks(prev => {
        const removed = prev.find(b => b.id === activeId);
        const next = prev.filter(b => b.id !== activeId);
        if (removed) {
          // 重新編號原容器 position
          const updatedSrc = next
            .filter(b => b.box === removed.box)
            .sort((a,b)=>a.position-b.position)
            .map((b, i) => ({ ...b, position: i }));
          const others = next.filter(b => b.box !== removed.box);
          const merged = [...others, ...updatedSrc];
          updatedSrc.forEach(b => void upsert(b));
          void remove(activeId);
          return merged;
        }
        void remove(activeId);
        return next;
      });
      return;
    }

    const activeBlock = blocks.find(b => b.id === activeId);
    if (!activeBlock) return;

    if ((boxes as string[]).includes(overId)) {
      // 放到容器尾端
      const targetBox = overId as Box;
      if (activeBlock.box === targetBox) return;
      setBlocks(prev => {
        const next = [...prev];
        const idx = next.findIndex(b => b.id === activeId);
        if (idx >= 0) {
          const pos = next.filter(b => b.box === targetBox).length;
          const updated = { ...next[idx], box: targetBox, position: pos };
          next[idx] = updated;
          void upsert(updated);
        }
        // 重新編號原容器 position
        const srcBox = activeBlock.box;
        const srcList = next.filter(b => b.box === srcBox).sort((a,b)=>a.position-b.position);
        srcList.forEach((b, i) => { if (b.position !== i) { b.position = i; void upsert(b); } });
        return next;
      });
      return;
    }

    // over 是某個項目 id
    const overBlock = blocks.find(b => b.id === overId);
    if (!overBlock) return;
    const targetBox = overBlock.box;

    setBlocks(prev => {
      // 取出目標容器與來源容器的當前順序
      const listBy = (box: Box) => prev.filter(b => b.box === box).sort((a,b)=>a.position-b.position);
      const srcBox = activeBlock.box;
      const srcList = listBy(srcBox).filter(b => b.id !== activeId);
      const dstList = listBy(targetBox);

      if (srcBox === targetBox) {
        // 容器內排序
        const fromIndex = dstList.findIndex(b => b.id === activeId);
        const toIndex = dstList.findIndex(b => b.id === overId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev;
        const reordered = arrayMove(dstList, fromIndex, toIndex).map((b, i) => ({ ...b, position: i }));
        const others = prev.filter(b => b.box !== targetBox);
        reordered.forEach(b => void upsert(b));
        return [...others, ...reordered];
      }

      // 跨容器插入
      const insertIndex = dstList.findIndex(b => b.id === overId);
      const moved: Block = { ...activeBlock, box: targetBox };
      const newDst = [
        ...dstList.slice(0, insertIndex),
        moved,
        ...dstList.slice(insertIndex),
      ].map((b, i) => ({ ...b, position: i }));
      const newSrc = srcList.map((b, i) => ({ ...b, position: i }));
      const keepOthers = prev.filter(b => b.box !== srcBox && b.box !== targetBox);
      newDst.forEach(b => void upsert(b));
      newSrc.forEach(b => void upsert(b));
      return [...keepOthers, ...newSrc, ...newDst];
    });
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(blocks, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'reviewer-export.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]; if (!file) return;
    file.text().then(t => {
      try {
        const data = JSON.parse(t); if (!Array.isArray(data)) throw new Error('格式錯誤');
        setBlocks(data);
      } catch (e: any) { alert('匯入失敗: ' + e.message); }
      finally { ev.target.value = ''; }
    });
  }

  function clearAll() {
    if (!confirm('確定清空所有資料？')) return;
  setBlocks([]);
  void clearAllDB();
  }

  return (
    <div>
    <header className="topbar">
        <h1>Reviewer</h1>
        <div className="actions">
          <button className={view==='board'? 'active': ''} onClick={() => setView('board')}>編輯</button>
          <button className={view==='reader'? 'active': ''} onClick={() => setView('reader')}>閱讀高亮</button>
          <button onClick={exportJSON}>匯出 JSON</button>
          <label className="import">匯入 JSON <input type="file" accept="application/json" onChange={importJSON} hidden /></label>
          <button onClick={clearAll}>清空</button>
        </div>
      </header>

    {view === 'board' ? (
    <main className="grid">
        <section className="panel">
          <h2>貼上文字 → 轉成 Blocks</h2>
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="每行或空行切分。" id="paste" />
          <div className="row" style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button onClick={addFromText}>切成 Blocks</button>
            <label style={{ fontSize:12, color:'#555' }}>切分模式：</label>
            <select value={mode} onChange={e => setMode(e.target.value as any)}>
              <option value="auto">自動</option>
              <option value="line">按行</option>
              <option value="sentence">按句（。.!?）</option>
              <option value="separator">按分隔符（、，,；;/| 或空白）</option>
            </select>
          </div>
          <p className="hint">拖動任意項目到右側的 Box。</p>
        </section>

        <DndContext onDragEnd={onDragEnd}>
          <SortableContext items={byBox.stash.map(b=>b.id)} strategy={verticalListSortingStrategy}>
            <DropZone id="stash" title={boxLabels.stash}>{byBox.stash.map(b => <DraggableItem key={b.id} block={b} />)}</DropZone>
          </SortableContext>
          <SortableContext items={byBox.box1.map(b=>b.id)} strategy={verticalListSortingStrategy}>
            <DropZone id="box1" title={boxLabels.box1}>{byBox.box1.map(b => <DraggableItem key={b.id} block={b} />)}</DropZone>
          </SortableContext>
          <SortableContext items={byBox.box2.map(b=>b.id)} strategy={verticalListSortingStrategy}>
            <DropZone id="box2" title={boxLabels.box2}>{byBox.box2.map(b => <DraggableItem key={b.id} block={b} />)}</DropZone>
          </SortableContext>
          <SortableContext items={byBox.box3.map(b=>b.id)} strategy={verticalListSortingStrategy}>
            <DropZone id="box3" title={boxLabels.box3}>{byBox.box3.map(b => <DraggableItem key={b.id} block={b} />)}</DropZone>
          </SortableContext>
          <TrashBin />
        </DndContext>
      </main>
      ) : (
        <Reader blocks={blocks} />
      )}
    </div>
  );
}