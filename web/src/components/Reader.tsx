import { useEffect, useMemo, useState } from 'react';
import { DndContext, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DraggableItem } from './DraggableItem';
import type { Block, Article } from '../types';
import { boxLabels } from '../App';
import { saveArticle, trimOldArticles, listArticles, getArticle, deleteArticle, deleteArticles, clearAllArticles } from '../storage/repo';
import { uuid } from '../utils/split';
import { sampleForLanguage } from '../utils/sampleBlocks';
import { buildBasePrompt, mockGenerateArticle } from '../utils/ai';

// 簡單閱讀高亮：使用者貼上文章內容，依據 box 顏色做底線
// box1: 紅、box2: 橙、box3: 綠
const colors: Record<string, string> = {
  box1: '#ef4444', // red-500
  box2: '#f59e0b', // amber-500
  box3: '#10b981', // emerald-500
};

export function Reader({ blocks, moveBlockToBox }: { blocks: Block[]; moveBlockToBox: (id: string, targetBox: Block['box'], opts?: { prepend?: boolean }) => void }) {
  // 將來會由 AI 生成文章 -> 這裡暫時保留 state，但不提供輸入框
  const [article, setArticle] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingArticleId, setLoadingArticleId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Sampling configuration state
  const [totalWanted, setTotalWanted] = useState(10);
  const [overrideBox1, setOverrideBox1] = useState<number | ''>('');
  const [overrideBox2, setOverrideBox2] = useState<number | ''>('');
  const [overrideBox3, setOverrideBox3] = useState<number | ''>('');
  const [lastSampleInfo, setLastSampleInfo] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [targetSentences, setTargetSentences] = useState(3);
  const [style, setStyle] = useState('explanatory');
  const [maxLength, setMaxLength] = useState(500);
  const [generating, setGenerating] = useState(false);
  const [lastLang, setLastLang] = useState<'ja'|'en' | null>(null);

  // 初始化從 localStorage 載入暫存文章
  useEffect(() => {
    const raw = localStorage.getItem('reviewer.currentArticle.v1');
    if (raw) setArticle(raw);
    const storedLang = localStorage.getItem('reviewer.lastLang');
    if (storedLang === 'ja' || storedLang === 'en') setLastLang(storedLang);
    refreshList();
  }, []);

  // 開發/暫時使用：可在 console 呼叫 window.setArticle('內容') 注入文章
  useEffect(() => {
    (window as any).setArticle = (s: string) => setArticle(s);
    return () => { delete (window as any).setArticle; };
  }, []);

  // 寫入暫存
  useEffect(() => {
    if (article) localStorage.setItem('reviewer.currentArticle.v1', article);
    else localStorage.removeItem('reviewer.currentArticle.v1');
  }, [article]);


  function generateMock(lang: 'ja' | 'en') {
    const res = sampleForLanguage(blocks, lang, {
      totalWanted,
      overrideBox1: overrideBox1 === '' ? undefined : overrideBox1,
      overrideBox2: overrideBox2 === '' ? undefined : overrideBox2,
      overrideBox3: overrideBox3 === '' ? undefined : overrideBox3,
    });
    setLastSampleInfo(res.detail);
    setLastLang(lang);
    // Build prompt each time sampling happens (user can still edit after)
    const basePrompt = buildBasePrompt({
      lang,
      blocks: res.selected.map(b => ({ id: b.id, text: b.text, box: b.box })),
      targetSentences,
      style: style || (lang==='ja' ? '説明' : 'explanatory'),
      maxLength
    });
  setPrompt(basePrompt);
    if (!res.selected.length) {
      setArticle(lang==='ja' ? 'これはテスト用の文章です。まだ単語が登録されていません。' : 'This is a mock article for testing. No words are stored yet.');
      return;
    }
    // 暫時：直接把選到的詞串成假文章
    const b1 = res.selected.filter(b=>b.box==='box1').map(b=>b.text);
    const b2 = res.selected.filter(b=>b.box==='box2').map(b=>b.text);
    const b3 = res.selected.filter(b=>b.box==='box3').map(b=>b.text);
    let sentences: string[] = [];
    if (lang==='ja') {
      sentences = [
        `まず${b1.slice(0,Math.min(3,b1.length)).join('、')}などの語彙を復習し、${b2.slice(0,2).join('と')}の使い方を確認します。`,
        `${b1.slice(3,6).join('、')}は試験で頻出であり、${b3[0]||''}の理解を助けます。`,
        `最後に${b2.slice(2,5).join('、')}を文脈で整理し、${b3.slice(1).join('、')}を定着させましょう。`
      ];
    } else {
      sentences = [
        `First we review ${b1.slice(0,3).join(', ')} while noticing ${b2.slice(0,2).join(' and ')}.`,
        `${b1.slice(3,6).join(', ')} often appear on exams and connect to ${b3[0]||''}.`,
        `Finally we reinforce ${b2.slice(2,5).join(', ')} and consolidate ${b3.slice(1).join(', ')}.`
      ];
    }
  setArticle(sentences.filter(Boolean).join('\n\n'));
  localStorage.setItem('reviewer.lastLang', lang);
  }

  async function runAI() {
    if (!prompt.trim()) return;
    setGenerating(true);
    try {
      const result = await mockGenerateArticle(prompt);
      setArticle(result.raw);
      // 如果 AI 有提供 html，用 html 覆蓋 (此處 mock 沒有)
    } finally { setGenerating(false); }
  }
  const dictByBox = useMemo(() => {
    return {
      box1: blocks.filter(b => b.box === 'box1').map(b => b.text).filter(Boolean),
      box2: blocks.filter(b => b.box === 'box2').map(b => b.text).filter(Boolean),
      box3: blocks.filter(b => b.box === 'box3').map(b => b.text).filter(Boolean),
    } as const;
  }, [blocks]);

  const { highlighted, usedIds } = useMemo(() => {
    let html = article;
    const used = new Set<string>();
    const replaceList: Array<{word: string, cls: string, color: string, lang: 'en'|'ja'|'unknown'}> = [];
    (['box1','box2','box3'] as const).forEach(box => {
      const list = [...new Set(blocks.filter(b => b.box===box).map(b => ({ word: b.text, lang: b.lang })))]
        .sort((a,b)=>b.word.length-a.word.length);
      list.forEach(({word,lang}) => replaceList.push({ word, lang: (lang as any), cls: `occ occ-${box}`, color: colors[box] }));
    });
    for (const { word, cls, color, lang } of replaceList) {
      if (!word) continue;
      const safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = (lang === 'en') ? `\\b${safe}\\b` : safe;
      const re = new RegExp(pattern, 'g');
      html = html.replace(re, (m) => {
        blocks.forEach(b => { if (b.text === word) used.add(b.id); });
        return `<span class=\"${cls}\" style=\"text-decoration: underline; text-decoration-color: ${color}; text-decoration-thickness: 2px; text-underline-offset: 2px;\">${m}</span>`;
      });
    }
    return { highlighted: html, usedIds: Array.from(used) };
  }, [article, dictByBox, blocks]);

  // 根據 usedIds 過濾出目前文章用到且語言與 lastLang 相符的 block，分組 (動態展示用)
  const usedByBox = useMemo(() => {
    const activeLang = lastLang || detectLangFromContent(article);
    const set = new Set(usedIds);
    const filtered = blocks.filter(b => set.has(b.id) && (activeLang ? b.lang === activeLang : true) && (b.box==='box1'||b.box==='box2'||b.box==='box3'));
    const sortPos = (a: Block, b: Block) => a.position - b.position || a.text.localeCompare(b.text);
    return {
      box1: filtered.filter(b=>b.box==='box1').sort(sortPos),
      box2: filtered.filter(b=>b.box==='box2').sort(sortPos),
      box3: filtered.filter(b=>b.box==='box3').sort(sortPos),
    };
  }, [usedIds, blocks, lastLang, article]);

  // 若重新載入組件且有文章與 usedIds，但沒有 lastLang，自動偵測
  useEffect(() => {
    if (article && usedIds.length && !lastLang) {
      const detected = detectLangFromContent(article);
      if (detected === 'ja' || detected === 'en') {
        setLastLang(detected);
        localStorage.setItem('reviewer.lastLang', detected);
      }
    }
  }, [article, usedIds, lastLang]);

  // 拖動處理：允許在三個 used box 之間拖動，更新全域 block 的 box 值
  function onUsedDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over?.id?.toString();
    if (!overId) return;
    const activeBlock = blocks.find(b=>b.id===activeId);
    const targetBlock = blocks.find(b => b.id === overId);
    let targetBox: Block['box'] | null = null;
    if (targetBlock) {
      targetBox = targetBlock.box;
    } else if (['box1','box2','box3'].includes(overId)) {
      targetBox = overId as Block['box'];
    }
    if (!targetBox || !['box1','box2','box3'].includes(targetBox)) return;
    const crossing = activeBlock && activeBlock.box !== targetBox;
    moveBlockToBox(activeId, targetBox, { prepend: !!crossing });
  }

  function detectLangFromContent(text: string): Block['lang'] {
    if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(text)) return 'ja';
    if (/[a-zA-Z]/.test(text)) return 'en';
    return 'unknown';
  }

  async function onSaveArticle() {
    if (!article.trim()) return;
    setSaving(true);
    try {
      const art: Article = {
        id: uuid(),
        createdAt: Date.now(),
        lang: detectLangFromContent(article),
        raw: article,
        html: highlighted,
        usedBlockIds: usedIds,
      };
      await saveArticle(art);
      await trimOldArticles(15);
      setLastSavedId(art.id);
      await refreshList();
      setTimeout(()=>setLastSavedId(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function refreshList() {
    setLoadingList(true);
    try {
      const list = await listArticles(30);
      setArticles(list);
    } finally { setLoadingList(false); }
  }

  async function loadArticle(id: string) {
    setLoadingArticleId(id);
    try {
      const a = await getArticle(id);
      if (a) {
        setArticle(a.raw);
        // 保存當前載入 ID 供 UI 高亮
        setLastSavedId(id);
      }
    } finally { setLoadingArticleId(null); }
  }

  async function removeArticle(id: string) {
    await deleteArticle(id);
    if (lastSavedId === id) setLastSavedId(null);
    await refreshList();
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function bulkDeleteSelected() {
    const ids = Array.from(selectedIds);
    await deleteArticles(ids);
    if (ids.includes(lastSavedId || '')) setLastSavedId(null);
    exitSelectMode();
    await refreshList();
  }

  async function deleteAllArticles() {
    await clearAllArticles();
    if (lastSavedId) setLastSavedId(null);
    exitSelectMode();
    await refreshList();
  }

  return (
    <main className="reader-area">
      <section className="panel reader-panel">
        <h2 style={{ marginBottom: 4 }}>AI 文章閱讀</h2>
        <div className="legend hint" style={{ marginBottom: 12 }}>
          顏色：{boxLabels.box1}=紅、{boxLabels.box2}=橙、{boxLabels.box3}=綠
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
          <button type="button" onClick={()=>generateMock('ja')}>假生成（日文）</button>
          <button type="button" onClick={()=>generateMock('en')}>假生成（英文）</button>
          <button type="button" disabled={!prompt || generating} onClick={runAI}>{generating ? '生成中...' : '用 AI 生成'}</button>
          <button type="button" disabled={!article || saving} onClick={onSaveArticle}>{saving ? '保存中...' : '保存文章'}</button>
          {lastSavedId && <span className="hint">已保存</span>}
        </div>
        <div className="hint" style={{ display:'flex', flexWrap:'wrap', gap:8, fontSize:12, marginBottom:12 }}>
          <label>總數 <input type="number" value={totalWanted} min={1} style={{ width:60 }} onChange={e=>setTotalWanted(Number(e.target.value)||1)} /></label>
          <label>box1 <input type="number" value={overrideBox1} placeholder="4" style={{ width:50 }} onChange={e=>setOverrideBox1(e.target.value===''?'':Number(e.target.value))} /></label>
          <label>box2 <input type="number" value={overrideBox2} placeholder="4" style={{ width:50 }} onChange={e=>setOverrideBox2(e.target.value===''?'':Number(e.target.value))} /></label>
          <label>box3 <input type="number" value={overrideBox3} placeholder="2" style={{ width:50 }} onChange={e=>setOverrideBox3(e.target.value===''?'':Number(e.target.value))} /></label>
          <label>句數 <input type="number" value={targetSentences} min={1} style={{ width:50 }} onChange={e=>setTargetSentences(Number(e.target.value)||1)} /></label>
          <label>風格 
            <select value={style} onChange={e=>setStyle(e.target.value)} style={{ width:140 }}>
              <option value="explanatory">說明</option>
              <option value="story">故事</option>
              <option value="dialogue">對話</option>
              <option value="news-like">新聞風</option>
              <option value="jlpt">日檢 (JLPT)</option>
              <option value="toeic">多益 (TOEIC)</option>
              <option value="toefl">托福 (TOEFL)</option>
            </select>
          </label>
          <label>MaxLen <input type="number" value={maxLength} min={100} style={{ width:70 }} onChange={e=>setMaxLength(Number(e.target.value)||500)} /></label>
        </div>
        <details style={{ marginBottom:12 }} open>
          <summary style={{ cursor:'pointer', fontWeight:600 }}>Prompt (可編輯)</summary>
          <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} style={{ width:'100%', minHeight:160, marginTop:8, fontFamily:'monospace', fontSize:12 }} />
          {lastLang && <div className="hint" style={{ marginTop:4 }}>目前語言: {lastLang}</div>}
        </details>
        {lastSampleInfo && <details className="hint" style={{ marginBottom:12 }}>
          <summary style={{ cursor:'pointer' }}>抽樣細節</summary>
          <pre style={{ whiteSpace:'pre-wrap', fontSize:11, lineHeight:1.4 }}>{lastSampleInfo}</pre>
        </details>}
        <details style={{ marginBottom: 16 }} open>
          <summary style={{ cursor:'pointer', fontWeight:600 }}>已保存文章 ({loadingList?'載入中...':articles.length})</summary>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', margin:'8px 0' }}>
            {!selectMode && <button type="button" disabled={!articles.length} onClick={()=>setSelectMode(true)}>選取刪除</button>}
            {selectMode && <>
              <button type="button" onClick={exitSelectMode}>取消</button>
              <button type="button" disabled={!selectedIds.size} onClick={bulkDeleteSelected}>刪除已選({selectedIds.size})</button>
              <button type="button" onClick={()=>setSelectedIds(new Set(articles.map(a=>a.id)))}>全選</button>
            </>}
            <button type="button" disabled={!articles.length} onClick={deleteAllArticles}>全部清除</button>
          </div>
          {articles.length === 0 && !loadingList && <div className="hint" style={{ padding:'4px 0' }}>尚無保存文章</div>}
          <ul style={{ listStyle:'none', margin:8, padding:0, display:'flex', flexDirection:'column', gap:4, maxHeight:200, overflow:'auto' }}>
            {articles.map(a => (
              <li key={a.id} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, background: selectMode && selectedIds.has(a.id)? '#fee2e2':'transparent', padding:'2px 4px', borderRadius:4 }}>
                {selectMode && (
                  <input type="checkbox" checked={selectedIds.has(a.id)} onChange={()=>toggleSelect(a.id)} />
                )}
                <button style={{ padding:'4px 8px', background:'#fff', color:'#111', border:'1px solid var(--border)' }} disabled={loadingArticleId===a.id} onClick={()=>loadArticle(a.id)}>載入</button>
                <span style={{ flex:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{new Date(a.createdAt).toLocaleString()} · {a.lang} · {a.raw.slice(0,40).replace(/\n/g,' ')}{a.raw.length>40?'…':''}</span>
                {!selectMode && <button style={{ background:'#dc2626' }} onClick={()=>removeArticle(a.id)}>刪除</button>}
              </li>
            ))}
          </ul>
        </details>
        {article ? (
          <div className="article" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <div className="article empty">尚未載入文章。請在未來的「生成」功能產生內容或在 console 使用 setArticle('...') 注入測試。</div>
        )}
    {usedIds.length > 0 && (
          <div style={{ marginTop:24 }}>
      <h3 style={{ margin:'0 0 8px', fontSize:15 }}>本篇使用詞彙（{(lastLang || detectLangFromContent(article))==='ja'?'日文':'英文'}）</h3>
            <DndContext onDragEnd={onUsedDragEnd}>
              <div style={{ display:'grid', gap:12, gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))' }}>
                {(['box1','box2','box3'] as const).map(box => (
                  <div key={box} className={`panel zone-mini zone-${box}`} style={{ minHeight:120 }}>
                    <div className="zone-head" style={{ marginBottom:4 }}>
                      <h2 style={{ fontSize:14, margin:0 }}>{boxLabels[box]}</h2>
                    </div>
                    <SortableContext items={usedByBox[box].map(b=>b.id)} strategy={verticalListSortingStrategy}>
                      <ul className="list" style={{ maxHeight:160 }}>
                        {usedByBox[box].map(b => (
                          <DraggableItem key={b.id} block={b} />
                        ))}
                        {!usedByBox[box].length && <li className="hint" style={{ fontSize:12, color:'var(--muted)' }}>無</li>}
                      </ul>
                    </SortableContext>
                  </div>
                ))}
              </div>
            </DndContext>
          </div>
        )}
      </section>
    </main>
  );
}
