import { useEffect, useMemo, useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { DropZone } from './components/DropZone';
// TrashBin 不再用刪除區 (保留檔案但不使用)
import { DraggableItem } from './components/DraggableItem';
import type { Block, Box } from './types';
import { splitToBlocks } from './utils/split';
import { db } from './storage/db';
import { getAllByBox, bulkAdd, upsert, clearAll as clearAllDB } from './storage/repo';
import { Reader } from './components/Reader';

const boxes: Box[] = ['stash', 'box1', 'box2', 'box3', 'trash'];
export const boxLabels: Record<Box, string> = {
  stash: '暫存',
  box1: '沒印象',
  box2: '不熟',
  box3: '熟悉',
  trash: '回收',
};

export default function App() {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'auto'|'line'|'sentence'|'separator'>('auto');
  const [view, setView] = useState<'board'|'reader'>('board');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [search, setSearch] = useState<{[k in Box]?: string}>({});

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
  setBlocks([ ...grouped.stash, ...grouped.box1, ...grouped.box2, ...grouped.box3, ...grouped.trash ]);
    })();
  }, []);

  const byBox = useMemo(() => {
  const map: Record<Box, Block[]> = { stash: [], box1: [], box2: [], box3: [], trash: [] };
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

  // 不再有直接刪除行為，trash 當作普通 box

    const activeBlock = blocks.find(b => b.id === activeId);
    if (!activeBlock) return;

    // 語言分隔容器: box1-ja / box1-en 等
  const langContainerMatch = overId.match(/^(box[123])-(ja|en)$/);
    const isBaseBox = (boxes as string[]).includes(overId);
    if (langContainerMatch || isBaseBox) {
      // 放到容器尾端
  const targetBox = (langContainerMatch ? langContainerMatch[1] : overId) as Box;
      const targetLang = langContainerMatch ? (langContainerMatch[2] as 'ja'|'en') : undefined;
      // 若有語言限制, 且項目語言不同, 不動作
      if (targetLang && activeBlock.lang !== targetLang) return;
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

  function autoImportFromStash() {
    setBlocks(prev => {
      const box1Items = prev.filter(b => b.box==='box1').sort((a,b)=>a.position-b.position);
      let pos = box1Items.length;
      const mapped = prev.map(b => {
        if (b.box==='stash' && (b.lang==='ja' || b.lang==='en')) {
          const updated = { ...b, box:'box1' as Box, position: pos++ };
          void upsert(updated);
          return updated;
        }
        return b;
      });
      // 重排暫存
      const stashOrdered = mapped.filter(b=>b.box==='stash').sort((a,b)=>a.position-b.position);
      stashOrdered.forEach((b,i)=>{ if (b.position!==i){ b.position=i; void upsert(b);} });
      return mapped;
    });
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
  <main className="grid board-grid">
        <section className="panel input-panel">
          <h2>貼上文字 → 轉成 Blocks</h2>
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="每行或空行切分。" id="paste" />
          <div className="row" style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <button onClick={addFromText}>切成 Blocks</button>
            <label style={{ fontSize:12, color:'#555' }}>切分模式：</label>
            <select value={mode} onChange={e => setMode(e.target.value as any)}>
              <option value="auto">自動</option>
              <option value="line">按行</option>
              <option value="sentence">按句（。.!?）</option>
              <option value="separator">按分隔符（、，,；;/| 或空白）</option>
            </select>
          </div>
          <p className="hint">右側：上排 日本語 (日)；下排 English (英)。可搜尋、拖動。同一難度 Box 兩行共享資料。</p>
        </section>
        <DndContext onDragEnd={onDragEnd}>
          {/* 暫存只一個 */}
          <SortableContext items={byBox.stash.filter(b=>!search.stash || b.text.includes(search.stash)).map(b=>b.id)} strategy={verticalListSortingStrategy}>
            <DropZone
              id="stash"
              title={boxLabels.stash}
              colorClass="zone-stash"
              showSearch
              search={search.stash||''}
              onSearchChange={v=>setSearch(s=>({...s,stash:v}))}
              actions={<button type="button" onClick={autoImportFromStash} style={{ background:'#6366f1' }}>自動導入</button>}
            >
              {byBox.stash.filter(b=>!search.stash || b.text.includes(search.stash)).map(b=> <DraggableItem key={b.id} block={b} />)}
            </DropZone>
          </SortableContext>
          {/* Trash 單一容器 (不分語言) */}
          <SortableContext items={byBox.trash.filter(b=>!search.trash || b.text.includes(search.trash)).map(b=>b.id)} strategy={verticalListSortingStrategy}>
            <DropZone
              id="trash"
              title={boxLabels.trash}
              colorClass="zone-trash"
              showSearch
              search={search.trash||''}
              onSearchChange={v=>setSearch(s=>({...s,trash:v}))}
            >
              {byBox.trash.filter(b=>!search.trash || b.text.includes(search.trash)).map(b=> <DraggableItem key={b.id} block={b} />)}
            </DropZone>
          </SortableContext>
          {/* 上排 日文 */}
          {(['box1','box2','box3'] as Box[]).map(box => {
            const list = byBox[box].filter(b=>b.lang==='ja').filter(b=>!search[box] || b.text.includes(search[box]!));
            return (
              <SortableContext key={box+'-ja'} items={list.map(b=>b.id)} strategy={verticalListSortingStrategy}>
                <DropZone
                  id={`${box}-ja`}
                  title={`${boxLabels[box]} (日)`}
                  colorClass={`zone-${box} zone-${box}-ja`}
                  showSearch
                  search={search[box]||''}
                  onSearchChange={v=>setSearch(s=>({...s,[box]:v}))}
                >
                  {list.map(b=> <DraggableItem key={b.id} block={b} />)}
                </DropZone>
              </SortableContext>
            );
          })}
          {/* 下排 英文 */}
          {(['box1','box2','box3'] as Box[]).map(box => {
            const list = byBox[box].filter(b=>b.lang==='en').filter(b=>!search[box] || b.text.includes(search[box]!));
            return (
              <SortableContext key={box+'-en'} items={list.map(b=>b.id)} strategy={verticalListSortingStrategy}>
                <DropZone
                  id={`${box}-en`}
                  title={`${boxLabels[box]} (英)`}
                  colorClass={`zone-${box} zone-${box}-en`}
                  showSearch
                  search={search[box]||''}
                  onSearchChange={v=>setSearch(s=>({...s,[box]:v}))}
                >
                  {list.map(b=> <DraggableItem key={b.id} block={b} />)}
                </DropZone>
              </SortableContext>
            );
          })}
        </DndContext>
      </main>
      ) : (
        <Reader blocks={blocks} />
      )}
    </div>
  );
}