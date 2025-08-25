import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragEndEvent, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DraggableItem } from './DraggableItem';
import type { Block, Article } from '../types';
import { boxLabels } from '../App';
import { saveArticle, trimOldArticles, listArticles, getArticle, deleteArticle, deleteArticles, clearAllArticles, listUnreadArticles, getUnreadArticle, saveUnreadArticle, deleteUnreadArticle, deleteUnreadArticles, clearAllUnreadArticles } from '../storage/repo';
import { uuid } from '../utils/split';
import { sampleForLanguage } from '../utils/sampleBlocks';
import { buildBasePrompt, mockGenerateArticle, generateWithGemini } from '../utils/ai';

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
  const [unreadArticles, setUnreadArticles] = useState<Article[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingUnreadList, setLoadingUnreadList] = useState(false);
  const [loadingArticleId, setLoadingArticleId] = useState<string | null>(null);
  const [loadingUnreadArticleId, setLoadingUnreadArticleId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectUnreadMode, setSelectUnreadMode] = useState(false);
  const [selectedUnreadIds, setSelectedUnreadIds] = useState<Set<string>>(new Set());
  // Sampling configuration state
  // 讀取初始設定（同步）避免切換後閃爍
  function readInitialConfig() {
    try {
      const raw = localStorage.getItem('reviewer.reader.config.v1');
      if (!raw) return {} as any;
      return JSON.parse(raw) || {};
    } catch { return {} as any; }
  }
  const initCfg = readInitialConfig();
  const [totalWanted, setTotalWanted] = useState(initCfg.totalWanted ?? 10);
  const [overrideBox1, setOverrideBox1] = useState<number | ''>(initCfg.overrideBox1 === '' || typeof initCfg.overrideBox1 === 'number' ? initCfg.overrideBox1 : '');
  const [overrideBox2, setOverrideBox2] = useState<number | ''>(initCfg.overrideBox2 === '' || typeof initCfg.overrideBox2 === 'number' ? initCfg.overrideBox2 : '');
  const [overrideBox3, setOverrideBox3] = useState<number | ''>(initCfg.overrideBox3 === '' || typeof initCfg.overrideBox3 === 'number' ? initCfg.overrideBox3 : '');
  const [lastSampleInfo, setLastSampleInfo] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [targetSentences, setTargetSentences] = useState(initCfg.targetSentences ?? 3);
  const [style, setStyle] = useState(initCfg.style ?? 'explanatory');
  const [maxLength, setMaxLength] = useState(initCfg.maxLength ?? 500);
  const [generating, setGenerating] = useState(false);
  const [lastLang, setLastLang] = useState<'ja'|'en' | null>(null);
  const [genLang, setGenLang] = useState<'ja'|'en'>(()=> (lastLang || 'ja'));
  const [genStatus, setGenStatus] = useState('');
  const [genError, setGenError] = useState('');
  // 批次生成
  const [batchCount, setBatchCount] = useState(1); // 一次要幾篇
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0); // 已完成篇數
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [batchPaused, setBatchPaused] = useState(false); // 冷卻中暫停
  const [progressVisibleUntil, setProgressVisibleUntil] = useState<number | null>(null);
  // Magic Bag (收集詞彙) 狀態：僅複製，不影響原 block
  type MagicItem = { id: string; sourceBlockId: string; text: string; lang: Block['lang']; box: Block['box']; addedAt: number; copied?: boolean };
  const [magicBag, setMagicBag] = useState<MagicItem[]>(()=>{
    try { const raw = localStorage.getItem('reviewer.magicBag.v1'); if (raw) { const arr = JSON.parse(raw) as MagicItem[]; return Array.isArray(arr)? arr.map(i=>({...i})) : []; } } catch {} return []; });
  // Magic Bag 進階狀態
  const [magicNotice, setMagicNotice] = useState(''); // 顯示操作/重複提示
  const [duplicateHighlightId, setDuplicateHighlightId] = useState<string | null>(null); // 重複項目高亮
  const [magicSelectMode, setMagicSelectMode] = useState(false);
  const [selectedMagic, setSelectedMagic] = useState<Set<string>>(new Set());
  const [magicFilter, setMagicFilter] = useState<'all'|'ja'|'en'>(()=>{
    const f = localStorage.getItem('reviewer.magicBag.filter');
    return f==='ja'?'ja': f==='en'?'en':'all';
  });
  const [includeCopied, setIncludeCopied] = useState<boolean>(()=> localStorage.getItem('reviewer.magicBag.includeCopied')==='0'? false : true);
  useEffect(()=>{ localStorage.setItem('reviewer.magicBag.includeCopied', includeCopied? '1':'0'); }, [includeCopied]);
  const [magicOrder, setMagicOrder] = useState<'newest'|'oldest'|'hardToEasy'|'easyToHard'>(()=>{
    const o = localStorage.getItem('reviewer.magicBag.order');
    return (o==='oldest'||o==='hardToEasy'||o==='easyToHard')? o : 'newest';
  });
  useEffect(()=>{ localStorage.setItem('reviewer.magicBag.order', magicOrder); }, [magicOrder]);
  useEffect(()=>{ localStorage.setItem('reviewer.magicBag.filter', magicFilter); }, [magicFilter]);
  function persistMagicBag(next: MagicItem[]) { localStorage.setItem('reviewer.magicBag.v1', JSON.stringify(next)); }
  function addToMagicBag(b: Block) {
    setMagicBag(prev => {
      const exist = prev.find(i=>i.sourceBlockId===b.id);
      if (exist) { // 避免重複並提示 + 高亮
        setMagicNotice('已在袋子中');
        setDuplicateHighlightId(exist.id);
        setTimeout(()=>setMagicNotice(''), 1500);
        setTimeout(()=>setDuplicateHighlightId(id=> id===exist.id ? null : id), 1600);
        return prev;
      }
      const next = [...prev, { id: uuid(), sourceBlockId: b.id, text: b.text, lang: b.lang, box: b.box, addedAt: Date.now() }];
      persistMagicBag(next); return next;
    });
  }
  function removeFromMagicBag(id: string) {
    setMagicBag(prev => { const next = prev.filter(i=>i.id!==id); persistMagicBag(next); return next; });
  }
  function clearMagicBag() { setMagicBag(()=>{ persistMagicBag([]); return []; }); }
  function toggleMagicSelect(id: string) {
    setSelectedMagic(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function exitMagicSelectMode() { setMagicSelectMode(false); setSelectedMagic(new Set()); }
  async function copyText(str: string) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(str);
      } else {
        const ta = document.createElement('textarea');
        ta.value = str; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
      setMagicNotice('已複製'); setTimeout(()=>setMagicNotice(''), 1200);
    } catch (e:any) {
      setMagicNotice('複製失敗'); setTimeout(()=>setMagicNotice(''), 1500);
    }
  }
  function copyAllMagic() {
  const list = magicBag.filter(i=> (magicFilter==='all'? true : i.lang===magicFilter) && (includeCopied || !i.copied));
  if (!list.length) { setMagicNotice('無可複製'); setTimeout(()=>setMagicNotice(''), 1000); return; }
  copyText(list.map(i=>i.text).join('\n'));
  markItemsCopied(list.map(i=>i.id));
  }
  function copySelectedMagic() {
  if (!selectedMagic.size) return;
  const list = magicBag.filter(i=>selectedMagic.has(i.id) && (includeCopied || !i.copied));
  if (!list.length) { setMagicNotice('無可複製'); setTimeout(()=>setMagicNotice(''), 1000); return; }
  copyText(list.map(i=>i.text).join('\n'));
  markItemsCopied(list.map(i=>i.id));
  }
  function deleteSelectedMagic() {
    if (!selectedMagic.size) return;
    setMagicBag(prev => { const next = prev.filter(i=>!selectedMagic.has(i.id)); persistMagicBag(next); return next; });
    setMagicNotice('已刪除'); setTimeout(()=>setMagicNotice(''), 1000);
    exitMagicSelectMode();
  }
  function selectAllMagic() {
    setSelectedMagic(new Set(magicBag.map(i=>i.id)));
  }
  // 生成詞彙說明 prompt 片段並加入主 prompt，同時複製
  function buildMagicExplainSnippet(items: MagicItem[]) {
    if (!items.length) return '';
    const words = items.map(it => ({ id: it.id, word: it.text, lang: it.lang }));
    const listStr = words.map(w=>`{"id":"${w.id}","word":"${w.word.replace(/"/g,'\\"')}","lang":"${w.lang}"}`).join(',\n  ');
  return `請協助解釋下列詞彙並提供讀音、音檔、中文解釋、例句與補充：\n[\n  ${listStr}\n]\n輸出格式：\n對每個詞請至少涵蓋：\n{id, word, reading, audio, zh, examples:[{sentence, zh}], notes}\n欄位說明：\n- reading: 日文用平假名/片假名；英文給 IPA。\n- audio: 若能提供發音 URL 或簡單 TTS 建議，放在這裡；無則可留空或給建議。\n- zh: 精簡且精準中文釋義（可 1~3 條，以；分隔或列點）。\n- examples: 1~2 個例句，每句含原文 sentence 與中文翻譯 zh。\n- notes: 詞性 / 常見搭配 / 語感差異 / 注意事項 / 記憶法。\n請保持每個詞分段清晰；若附 JSON，字段順序採 id, word, reading, audio, zh, examples, notes。`;
  }
  async function copyAndAppendMagicToPrompt() {
    const source = (magicSelectMode && selectedMagic.size ? magicBag.filter(i=>selectedMagic.has(i.id)) : magicBag.filter(i=> magicFilter==='all' ? true : i.lang===magicFilter))
      .filter(i=> includeCopied || !i.copied);
    if (!source.length) { setMagicNotice('無可加入詞'); setTimeout(()=>setMagicNotice(''), 1000); return; }
    const snippet = buildMagicExplainSnippet(source);
    if (!snippet) return;
  // 需求：只顯示當下最新觸發的 prompt，不累積
  setPrompt(snippet);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(snippet);
      else {
        const ta = document.createElement('textarea'); ta.value = snippet; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
      setMagicNotice('已加入並複製'); setTimeout(()=>setMagicNotice(''), 1200);
    } catch {
      setMagicNotice('加入成功，複製失敗'); setTimeout(()=>setMagicNotice(''), 1500);
    }
    markItemsCopied(source.map(i=>i.id));
  }
  function markItemsCopied(ids: string[]) {
    if (!ids.length) return;
    setMagicBag(prev => { const set = new Set(ids); const next = prev.map(i=> set.has(i.id)? {...i, copied:true}: i); persistMagicBag(next); return next; });
  }
  const generationHistoryRef = useRef<number[]>([]); // 儲存每篇成功生成的 timestamp
  const cancelRef = useRef(false);
  // 批次執行狀態持久化 key（避免切換工作區/重新整理後進度條消失）
  const BATCH_KEY = 'reviewer.batch.v1';
  // 重新整理導入語言選擇
  const [loadLang, setLoadLang] = useState<'ja'|'en'>(()=> (localStorage.getItem('reviewer.loadLang')==='en'?'en':'ja'));

  function persistBatchState(partial: any) {
    try {
      const base = localStorage.getItem(BATCH_KEY);
      const obj = base ? JSON.parse(base) : {};
      localStorage.setItem(BATCH_KEY, JSON.stringify({ ...obj, ...partial }));
    } catch {}
  }
  function clearPersistedBatch() {
    try { localStorage.removeItem(BATCH_KEY); } catch {}
  }

  // 啟動時讀取歷史（可選，失敗忽略）
  useEffect(()=>{
    try {
      const raw = localStorage.getItem('reviewer.gen.history');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) generationHistoryRef.current = arr.filter((n:any)=> typeof n === 'number');
      }
    } catch {}
    // 嘗試讀取未完成批次狀態
    try {
      const rawBatch = localStorage.getItem(BATCH_KEY);
      if (rawBatch) {
        const st = JSON.parse(rawBatch);
        if (st && typeof st.total === 'number' && typeof st.completed === 'number') {
          setBatchProgress(st.completed);
          setBatchCount(st.total);
            if (st.completed < st.total) {
              if (st.cooldownUntil && Date.now() < st.cooldownUntil) {
                setCooldownUntil(st.cooldownUntil);
                setBatchPaused(true);
                // 監聽冷卻結束後再續跑
              } else if (st.paused) {
                // 冷卻已過，自動續跑
                setTimeout(()=>resumeBatch(st.total - st.completed, st.total), 50);
              } else if (st.running) {
                setBatchRunning(true);
                setTimeout(()=>resumeBatch(st.total - st.completed, st.total), 50);
              }
            } else {
              clearPersistedBatch();
            }
        }
      }
    } catch {}
  }, []);

  function pruneHistory() {
    const now = Date.now();
    generationHistoryRef.current = generationHistoryRef.current.filter(ts => now - ts < 60_000);
  }
  function pushHistory(ts: number) {
    generationHistoryRef.current.push(ts);
    localStorage.setItem('reviewer.gen.history', JSON.stringify(generationHistoryRef.current));
  }
  function checkRateLimit(nextCount = 1): { ok: boolean; waitMs?: number } {
    pruneHistory();
    const now = Date.now();
    if (generationHistoryRef.current.length + nextCount > 10) {
      const oldest = Math.min(...generationHistoryRef.current);
      const waitMs = 60_000 - (now - oldest);
      return { ok: false, waitMs: Math.max(waitMs, 0) };
    }
    return { ok: true };
  }

  useEffect(()=>{
    if (!cooldownUntil) return;
    const id = setInterval(()=>{
      if (cooldownUntil && Date.now() >= cooldownUntil) {
        setCooldownUntil(null);
      } else {
        // 觸發 rerender
        setGenStatus(s => s === '' ? '' : s);
      }
    }, 1000);
    return ()=>clearInterval(id);
  }, [cooldownUntil]);
  // Gemini 設定
  const [geminiApiKey, setGeminiApiKey] = useState<string>(()=> localStorage.getItem('reviewer.gemini.apiKey') || '');
  const [geminiModel, setGeminiModel] = useState<string>(()=> localStorage.getItem('reviewer.gemini.model') || 'gemini-2.5-flash');
  const loadedConfigRef = useRef(false);

  // 初始化從 localStorage 載入暫存文章
  useEffect(() => {
    const raw = localStorage.getItem('reviewer.currentArticle.v1');
    if (raw) setArticle(raw);
    const storedLang = localStorage.getItem('reviewer.lastLang');
    if (storedLang === 'ja' || storedLang === 'en') setLastLang(storedLang);
    // 載入參數設定
    const cfgRaw = localStorage.getItem('reviewer.reader.config.v1');
    if (cfgRaw) {
      try {
        const cfg = JSON.parse(cfgRaw);
        if (typeof cfg.totalWanted === 'number') setTotalWanted(cfg.totalWanted);
        if (cfg.overrideBox1 === '' || typeof cfg.overrideBox1 === 'number') setOverrideBox1(cfg.overrideBox1);
        if (cfg.overrideBox2 === '' || typeof cfg.overrideBox2 === 'number') setOverrideBox2(cfg.overrideBox2);
        if (cfg.overrideBox3 === '' || typeof cfg.overrideBox3 === 'number') setOverrideBox3(cfg.overrideBox3);
        if (typeof cfg.targetSentences === 'number') setTargetSentences(cfg.targetSentences);
        if (typeof cfg.style === 'string') setStyle(cfg.style);
        if (typeof cfg.maxLength === 'number') setMaxLength(cfg.maxLength);
      } catch {}
    }
    loadedConfigRef.current = true;
  refreshList();
  refreshUnreadList();
  }, []);

  // 保存設定
  useEffect(() => {
    if (!loadedConfigRef.current) return; // 避免初始載入前覆寫
    const cfg = {
      totalWanted,
      overrideBox1,
      overrideBox2,
      overrideBox3,
      targetSentences,
      style,
      maxLength,
    };
    localStorage.setItem('reviewer.reader.config.v1', JSON.stringify(cfg));
  }, [totalWanted, overrideBox1, overrideBox2, overrideBox3, targetSentences, style, maxLength]);

  // 保存 Gemini 設定
  useEffect(()=>{
    localStorage.setItem('reviewer.gemini.apiKey', geminiApiKey);
  }, [geminiApiKey]);
  useEffect(()=>{
    localStorage.setItem('reviewer.gemini.model', geminiModel);
  }, [geminiModel]);

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
    setGenError('');
    setGenStatus('抽樣中');
    const res = sampleForLanguage(blocks, genLang, {
      totalWanted,
      overrideBox1: overrideBox1 === '' ? undefined : overrideBox1,
      overrideBox2: overrideBox2 === '' ? undefined : overrideBox2,
      overrideBox3: overrideBox3 === '' ? undefined : overrideBox3,
    });
    setLastSampleInfo(res.detail);
    setLastLang(genLang);
    const builtPrompt = buildBasePrompt({
      lang: genLang,
      blocks: res.selected.map(b=>({ id: b.id, text: b.text, box: b.box })),
      targetSentences,
      style: style || (genLang==='ja' ? '説明' : 'explanatory'),
      maxLength
    });
    setPrompt(builtPrompt);
    if (!res.selected.length) {
      setGenError('沒有可用的單字/語法，無法生成');
      setGenStatus('');
      return;
    }
    setGenerating(true);
    setGenStatus('呼叫模型');
    try {
      let raw=''; let html=''; let usedIds: string[] = [];
      if (geminiApiKey) {
        const result = await generateWithGemini({ apiKey: geminiApiKey, model: geminiModel, prompt: builtPrompt });
        raw = result.raw || '';
        html = result.html || raw;
        if ((result as any).usedIds && Array.isArray((result as any).usedIds)) usedIds = (result as any).usedIds;
        if (!usedIds.length) {
          const matches = html.match(/data-item-id="(.*?)"/g) || [];
          usedIds = Array.from(new Set(matches.map(s=>s.replace(/.*data-item-id="(.*)".*/, '$1'))));
        }
      } else {
        const mock = await mockGenerateArticle(builtPrompt);
        raw = mock.raw; html = mock.html || mock.raw;
        usedIds = res.selected.map(b=>b.id);
      }
      setGenStatus('儲存中');
      const art: Article = {
        id: uuid(),
        createdAt: Date.now(),
        lang: genLang,
        raw,
        html,
        usedBlockIds: usedIds.length ? usedIds : res.selected.map(b=>b.id)
      };
      await saveUnreadArticle(art);
      await refreshUnreadList();
  // 不立即顯示文章，只放入未讀列表
      setGenStatus('完成');
  setTimeout(()=>setGenStatus(''), 1500);
  setProgressVisibleUntil(Date.now()+1800);
    } catch (e:any) {
      setGenError(e.message || String(e));
      setGenStatus('失敗');
  setTimeout(()=>setGenStatus(''), 3000);
  setProgressVisibleUntil(Date.now()+3200);
    } finally {
      setGenerating(false);
    }
  }

  async function batchRunAI() {
    setGenError('');
    setBatchErrors([]);
    const count = Math.min(Math.max(batchCount,1), 10);
    // 檢查速率限制
    pruneHistory();
    const rl = checkRateLimit(count);
    if (!rl.ok) {
      const until = Date.now() + (rl.waitMs || 60_000);
      setCooldownUntil(until);
      setGenError(`超過每分鐘 10 篇限制，冷卻中，請等待 ${(Math.ceil((until - Date.now())/1000))} 秒`);
      return;
    }
    setBatchRunning(true);
    setBatchProgress(0);
    cancelRef.current = false;
  persistBatchState({ running:true, total:count, completed:0, startedAt: Date.now() });
    for (let i=0;i<count;i++) {
      if (cancelRef.current) break;
      setGenStatus(`第 ${i+1}/${count} 篇`);
      try {
        await runAI(); // runAI 會自行儲存一篇
        if (cancelRef.current) break;
        pushHistory(Date.now());
    setBatchProgress(p=> { const np = p+1; persistBatchState({ completed: np }); return np; });
    pruneHistory();
      } catch (e:any) {
        setBatchErrors(errs=>[...errs, `第${i+1}篇: ${(e?.message)||String(e)}`]);
      }
      // 若途中超過 10 篇，啟動冷卻
      const rl2 = checkRateLimit(0);
      if (!rl2.ok) {
        const until = Date.now() + (rl2.waitMs || 60_000);
        setCooldownUntil(until);
        setGenError('已達每分鐘 10 篇，進入冷卻');
        setBatchPaused(true);
        persistBatchState({ cooldownUntil: until, paused:true, running:false });
        break;
      }
    }
    if (!cancelRef.current && !batchPaused && (batchProgress >= count || (batchProgress === count))) {
      setGenStatus('');
      setBatchRunning(false);
      cancelRef.current = false;
      clearPersistedBatch();
  setProgressVisibleUntil(Date.now()+1500);
    } else if (cancelRef.current) {
      persistBatchState({ running:false, paused:false });
      setGenStatus('');
      setBatchRunning(false);
      cancelRef.current = false;
  setProgressVisibleUntil(Date.now()+800);
      // 不清除，保留進度
    }
  }

  // 重新啟動後續跑的批次
  async function resumeBatch(remaining: number, originalTotal: number) {
    cancelRef.current = false;
    setBatchRunning(true);
    setBatchPaused(false);
    persistBatchState({ running:true, paused:false });
    for (let i=0;i<remaining;i++) {
      if (cancelRef.current) break;
      const already = batchProgress + i;
      setGenStatus(`第 ${already+1}/${originalTotal} 篇`);
      try {
        await runAI();
        if (cancelRef.current) break;
        pushHistory(Date.now());
        setBatchProgress(p=> { const np = p+1; persistBatchState({ running:true, total: originalTotal, completed: np }); return np; });
        pruneHistory();
      } catch (e:any) {
        setBatchErrors(errs=>[...errs, `第${already+1}篇: ${(e?.message)||String(e)}`]);
      }
      const rl2 = checkRateLimit(0);
      if (!rl2.ok) {
        const until = Date.now() + (rl2.waitMs || 60_000);
        setCooldownUntil(until);
        setGenError('已達每分鐘 10 篇，進入冷卻');
        setBatchPaused(true);
        persistBatchState({ cooldownUntil: until, paused:true, running:false });
        break;
      }
    }
    if (!batchPaused && !cancelRef.current && batchProgress >= originalTotal) {
      setGenStatus('');
      setBatchRunning(false);
      cancelRef.current = false;
      clearPersistedBatch();
  setProgressVisibleUntil(Date.now()+1500);
    } else if (cancelRef.current) {
      setGenStatus('');
      setBatchRunning(false);
      cancelRef.current = false;
      persistBatchState({ running:false, paused:false });
  setProgressVisibleUntil(Date.now()+800);
    }
  }

  // 讀取最舊未讀文章並顯示：刪除目前文章內容，載入最舊一篇
  async function loadOldestUnreadAndReplace() {
  const list = unreadArticles.filter(a=>a.lang===loadLang);
  if (!list.length) return;
  // list 是所有選定語言的文章，新->舊排序，所以 oldest 為 createdAt 最小
  const oldest = list.reduce((acc, cur)=> cur.createdAt < acc.createdAt ? cur : acc, list[0]);
    const full = await getUnreadArticle(oldest.id);
    if (full) {
      setArticle(full.raw);
      setLastSavedId(null);
      const lang = full.lang || detectLangFromContent(full.raw);
      if (lang === 'ja' || lang === 'en') {
        setLastLang(lang);
        localStorage.setItem('reviewer.lastLang', lang);
      }
      // 使用後可選擇是否從未讀刪除：這裡依需求移除
      await deleteUnreadArticle(full.id);
      await refreshUnreadList();
    }
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
  const ids = blocks.filter(b=>b.text===word).map(b=>b.id).join(',');
  return `<span class=\"${cls}\" data-word=\"${word.replace(/"/g,'&quot;')}\" data-block-ids=\"${ids}\" style=\"text-decoration: underline; text-decoration-color: ${color}; text-decoration-thickness: 2px; text-underline-offset: 2px; cursor: pointer;\">${m}</span>`;
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
    // 丟到 Magic Bag：複製
    if (overId === 'magic-bag-drop') {
      const blk = blocks.find(b=>b.id===activeId);
      if (blk) addToMagicBag(blk);
      return;
    }
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

  // 點擊文章底線詞彙 -> 加入 Magic Bag
  function handleArticleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (!target) return;
    if (target.classList.contains('occ')) {
      const idsAttr = target.getAttribute('data-block-ids');
      if (!idsAttr) return;
      const ids = idsAttr.split(',').filter(Boolean);
      // 逐一加入（保持唯一性）
      ids.forEach(id => {
        const blk = blocks.find(b=>b.id===id);
        if (blk) addToMagicBag(blk);
      });
    }
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

  async function addCurrentToUnread() {
    if (!article.trim()) return;
    const art: Article = {
      id: uuid(),
      createdAt: Date.now(),
      lang: detectLangFromContent(article),
      raw: article,
      html: highlighted,
      usedBlockIds: usedIds,
    };
    await saveUnreadArticle(art);
    await refreshUnreadList();
  }

  async function refreshList() {
    setLoadingList(true);
    try {
      const list = await listArticles(30);
      setArticles(list);
    } finally { setLoadingList(false); }
  }

  async function refreshUnreadList() {
    setLoadingUnreadList(true);
    try {
      const list = await listUnreadArticles(50);
      setUnreadArticles(list);
    } finally { setLoadingUnreadList(false); }
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

  async function loadUnreadArticle(id: string) {
    setLoadingUnreadArticleId(id);
    try {
      const a = await getUnreadArticle(id);
      if (a) {
        setArticle(a.raw);
        setLastSavedId(null);
        // 更新語言以觸發下方使用詞彙 box 切換
        const lang = a.lang || detectLangFromContent(a.raw);
        if (lang === 'ja' || lang === 'en') {
          setLastLang(lang);
          localStorage.setItem('reviewer.lastLang', lang);
        }
        // 載入後自動從未讀移除
        await deleteUnreadArticle(a.id);
        await refreshUnreadList();
      }
    } finally { setLoadingUnreadArticleId(null); }
  }

  async function removeArticle(id: string) {
    await deleteArticle(id);
    if (lastSavedId === id) setLastSavedId(null);
    await refreshList();
  }

  async function removeUnreadArticle(id: string) {
    await deleteUnreadArticle(id);
    await refreshUnreadList();
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function toggleSelectUnread(id: string) {
    setSelectedUnreadIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function exitSelectUnreadMode() {
    setSelectUnreadMode(false);
    setSelectedUnreadIds(new Set());
  }

  async function bulkDeleteSelected() {
    const ids = Array.from(selectedIds);
    await deleteArticles(ids);
    if (ids.includes(lastSavedId || '')) setLastSavedId(null);
    exitSelectMode();
    await refreshList();
  }

  async function bulkDeleteSelectedUnread() {
    const ids = Array.from(selectedUnreadIds);
    await deleteUnreadArticles(ids);
    exitSelectUnreadMode();
    await refreshUnreadList();
  }

  async function deleteAllArticles() {
    await clearAllArticles();
    if (lastSavedId) setLastSavedId(null);
    exitSelectMode();
    await refreshList();
  }

  async function deleteAllUnreadArticles() {
    await clearAllUnreadArticles();
    exitSelectUnreadMode();
    await refreshUnreadList();
  }

  return (
    <main className="reader-area">
      <DndContext onDragEnd={onUsedDragEnd}>
      <div className="reader-shell">
        <section className="panel reader-panel">
        {/* 移到標題上方的可折疊區塊 */}
        <details style={{ marginBottom:12 }}>
          <summary style={{ cursor:'pointer', fontWeight:600 }}>Prompt (可編輯)</summary>
          <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} style={{ width:'100%', minHeight:160, marginTop:8, fontFamily:'monospace', fontSize:12 }} />
          {lastLang && <div className="hint" style={{ marginTop:4 }}>目前語言: {lastLang}</div>}
          <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:8 }}>
            <label style={{ fontSize:12 }}>Gemini API Key
              <input type="password" value={geminiApiKey} placeholder="輸入後會保存在本機" onChange={e=>setGeminiApiKey(e.target.value.trim())} style={{ width:'100%', marginTop:4 }} />
            </label>
            <label style={{ fontSize:12 }}>Gemini 模型
              <select value={geminiModel} onChange={e=>setGeminiModel(e.target.value)} style={{ width:'100%', marginTop:4 }}>
                <option value="gemini-2.5-pro">gemini-2.5-pro (精準/推理)</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash (速度/性價比)</option>
                <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (更低延遲與成本)</option>
                <option value="gemini-2.0-flash">gemini-2.0-flash (穩定版 2.0 flash)</option>
                <option value="gemini-2.0-flash-lite">gemini-2.0-flash-lite</option>
                <option value="gemini-2.0-flash-live-001">gemini-2.0-flash-live-001 (Live / 可能非必要)</option>
                <option value="gemini-2.5-flash-preview-tts">gemini-2.5-flash-preview-tts (TTS 預覽)</option>
                <option value="gemini-2.5-pro-preview-tts">gemini-2.5-pro-preview-tts (TTS Pro)</option>
                <option value="gemini-1.5-flash">gemini-1.5-flash (Deprecated)</option>
                <option value="gemini-1.5-flash-8b">gemini-1.5-flash-8b (Deprecated)</option>
                <option value="gemini-1.5-pro">gemini-1.5-pro (Deprecated)</option>
              </select>
            </label>
            {!geminiApiKey && <div className="hint" style={{ fontSize:11, color:'#dc2626' }}>未填 API Key，會使用本地 mock 生成。</div>}
          </div>
        </details>
        <details style={{ marginBottom: 12 }}>
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
        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor:'pointer', fontWeight:600 }}>未讀的文章 ({loadingUnreadList?'載入中...':unreadArticles.length})</summary>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', margin:'8px 0' }}>
            {!selectUnreadMode && <button type="button" disabled={!unreadArticles.length} onClick={()=>setSelectUnreadMode(true)}>選取刪除</button>}
            {selectUnreadMode && <>
              <button type="button" onClick={exitSelectUnreadMode}>取消</button>
              <button type="button" disabled={!selectedUnreadIds.size} onClick={bulkDeleteSelectedUnread}>刪除已選({selectedUnreadIds.size})</button>
              <button type="button" onClick={()=>setSelectedUnreadIds(new Set(unreadArticles.map(a=>a.id)))}>全選</button>
            </>}
            <button type="button" disabled={!unreadArticles.length} onClick={deleteAllUnreadArticles}>全部清除</button>
          </div>
          {unreadArticles.length === 0 && !loadingUnreadList && <div className="hint" style={{ padding:'4px 0' }}>尚無未讀文章</div>}
          {unreadArticles.length>0 && (
            <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
              {(['ja','en'] as const).map(lang => {
                const list = unreadArticles.filter(a=>a.lang===lang);
                return (
                  <div key={lang} style={{ flex:'1 1 280px', minWidth:260 }}>
                    <h4 style={{ margin:'4px 0 4px', fontSize:13 }}>{lang==='ja'?'日文未讀':'英文未讀'} ({list.length})</h4>
                    <ul style={{ listStyle:'none', margin:4, padding:0, display:'flex', flexDirection:'column', gap:4, maxHeight:200, overflow:'auto', border:'1px solid var(--border)', borderRadius:4, paddingTop:4 }}>
                      {list.map(a => (
                        <li key={a.id} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, background: selectUnreadMode && selectedUnreadIds.has(a.id)? '#e0f2fe':'transparent', padding:'2px 6px', borderRadius:4 }}>
                          {selectUnreadMode && (
                            <input type="checkbox" checked={selectedUnreadIds.has(a.id)} onChange={()=>toggleSelectUnread(a.id)} />
                          )}
                          <button style={{ padding:'2px 6px', background:'#fff', color:'#111', border:'1px solid var(--border)' }} disabled={loadingUnreadArticleId===a.id} onClick={()=>loadUnreadArticle(a.id)}>載入</button>
                          <span style={{ flex:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{new Date(a.createdAt).toLocaleString()} · {a.raw.slice(0,34).replace(/\n/g,' ')}{a.raw.length>34?'…':''}</span>
                          {!selectUnreadMode && <button style={{ background:'#dc2626' }} onClick={()=>removeUnreadArticle(a.id)}>刪除</button>}
                        </li>
                      ))}
                      {!list.length && <li className="hint" style={{ fontSize:11, color:'var(--muted)', padding:'2px 6px' }}>無</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </details>
        <h2 style={{ marginBottom: 4 }}>AI 文章閱讀</h2>
        <div className="legend hint" style={{ marginBottom: 12 }}>
          顏色：{boxLabels.box1}=紅、{boxLabels.box2}=橙、{boxLabels.box3}=綠
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
          <button type="button" onClick={()=>generateMock('ja')}>假生成（日文）</button>
          <button type="button" onClick={()=>generateMock('en')}>假生成（英文）</button>
          <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12 }}>語言
            <select value={genLang} onChange={e=>setGenLang(e.target.value as any)} style={{ padding:'2px 4px' }}>
              <option value="ja">日文</option>
              <option value="en">英文</option>
            </select>
          </label>
          <label style={{ fontSize:12 }}>批次
            <input type="number" min={1} max={10} value={batchCount} onChange={e=>setBatchCount(Math.min(10, Math.max(1, Number(e.target.value)||1)))} style={{ width:60, marginLeft:4 }} />
          </label>
          <button type="button" disabled={generating || batchRunning || (!!cooldownUntil && Date.now()<cooldownUntil)} onClick={runAI}>{generating ? '生成中...' : '生成 1 篇'}</button>
          <button type="button" disabled={generating || batchRunning || (!!cooldownUntil && Date.now()<cooldownUntil)} onClick={batchRunAI}>{batchRunning ? '批次進行中' : `批次生成(${batchCount})`}</button>
          {batchRunning && <button type="button" onClick={()=>{cancelRef.current=true; setGenStatus('取消中'); clearPersistedBatch();}} style={{ background:'#dc2626' }}>取消</button>}
          <button type="button" disabled={!article || saving} onClick={onSaveArticle}>{saving ? '保存中...' : '保存文章'}</button>
          {lastSavedId && <span className="hint">已保存</span>}
          {genStatus && <span className="hint" style={{ minWidth:60 }}>{genStatus}</span>}
          {genError && <span className="hint" style={{ color:'#dc2626' }}>錯誤: {genError}</span>}
          {cooldownUntil && Date.now()<cooldownUntil && (
            <span className="hint" style={{ color:'#f59e0b' }}>冷卻 {Math.ceil((cooldownUntil-Date.now())/1000)}s</span>
          )}
        </div>
  {(generating || batchRunning || batchPaused || (progressVisibleUntil && Date.now()<progressVisibleUntil)) && (
          <div style={{ width:'100%', marginBottom:12 }}>
            <div style={{ position:'relative', height:6, background:'#eee', borderRadius:4, overflow:'hidden' }}>
              <div style={{ position:'absolute', left:0, top:0, bottom:0, width: (batchRunning||batchPaused)? `${(batchProgress/Math.max(batchCount,1))*100}%` : '100%', background: batchPaused? '#f59e0b':'#3b82f6', transition:'width .3s' }} />
            </div>
            {(batchRunning||batchPaused) && <div style={{ fontSize:11, marginTop:4 }}>進度 {batchProgress}/{batchCount} {batchPaused && '(冷卻暫停中)'}</div>}
          </div>
        )}
        {batchErrors.length>0 && (
          <details style={{ marginBottom:12 }} open>
            <summary style={{ fontSize:12, cursor:'pointer' }}>批次錯誤 ({batchErrors.length})</summary>
            <ul style={{ margin:4, paddingLeft:18, fontSize:11, color:'#dc2626' }}>
              {batchErrors.map((e,i)=><li key={i}>{e}</li>)}
            </ul>
          </details>
        )}
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
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
          <button type="button" onClick={loadOldestUnreadAndReplace} disabled={!unreadArticles.some(a=>a.lang===loadLang)}>重新整理並導入一篇新文章</button>
          <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12 }}>
            <select value={loadLang} onChange={e=>{ const v=e.target.value==='en'?'en':'ja'; setLoadLang(v); localStorage.setItem('reviewer.loadLang', v); }}>
              <option value="ja">日文</option>
              <option value="en">英文</option>
            </select>
          </label>
          <button type="button" disabled={!article} onClick={addCurrentToUnread}>返回未讀</button>
        </div>
  {/* Prompt 區塊已上移並預設收起 */}
        {lastSampleInfo && <details className="hint" style={{ marginBottom:12 }}>
          <summary style={{ cursor:'pointer' }}>抽樣細節</summary>
          <pre style={{ whiteSpace:'pre-wrap', fontSize:11, lineHeight:1.4 }}>{lastSampleInfo}</pre>
        </details>}
  {/* 已保存文章區塊已上移並預設收起 */}
        {article ? (
          <div className="article" onClick={handleArticleClick} dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <div className="article empty">尚未載入文章。請在未來的「生成」功能產生內容或在 console 使用 setArticle('...') 注入測試。</div>
        )}
    {usedIds.length > 0 && (
          <div style={{ marginTop:24 }}>
      <h3 style={{ margin:'0 0 8px', fontSize:15 }}>本篇使用詞彙（{(lastLang || detectLangFromContent(article))==='ja'?'日文':'英文'}）</h3>
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
          </div>
        )}
        </section>
        <aside className="panel reader-side-bag">
          {(() => {
            const Bag = () => {
              const { setNodeRef, isOver } = useDroppable({ id: 'magic-bag-drop' });
              return (
                <div id="magic-bag-drop" ref={setNodeRef} className={isOver? 'drag-over': ''} style={{ marginTop:8, minHeight:140, border:'2px dashed var(--border)', borderRadius:8, padding:6, background:'#fff', display:'flex', flexDirection:'column', gap:6 }}>
                  {magicBag.length===0 && <div className="hint" style={{ textAlign:'center', marginTop:36 }}>拖入詞彙</div>}
                  {magicBag
                    .filter(i=> magicFilter==='all' ? true : i.lang===magicFilter)
                    .sort((a,b)=>{
                      const famScore = (x: typeof a)=> x.box==='box1'?0: x.box==='box2'?1:2; // 0=沒印象,2=熟悉
                      switch(magicOrder) {
                        case 'newest': return b.addedAt - a.addedAt;
                        case 'oldest': return a.addedAt - b.addedAt;
                        case 'hardToEasy': {
                          const diff = famScore(a)-famScore(b);
                          return diff!==0? diff : b.addedAt - a.addedAt;
                        }
                        case 'easyToHard': {
                          const diff = famScore(b)-famScore(a);
                          return diff!==0? diff : b.addedAt - a.addedAt;
                        }
                        default: return b.addedAt - a.addedAt;
                      }
                    })
                    .map(item => {
                    const selected = selectedMagic.has(item.id);
                    return (
                      <div key={item.id}
                        onClick={()=>{ if (magicSelectMode) toggleMagicSelect(item.id); }}
                        style={{ border:'1px solid var(--border)', borderLeft:`6px solid ${colors[item.box]||'#999'}`, borderRadius:6, padding:'4px 6px 4px 6px', background: selected? '#e0f2fe': (duplicateHighlightId===item.id? '#fef3c7':'#f8fafc'), display:'flex', alignItems:'center', gap:6, cursor: magicSelectMode? 'pointer':'default', fontWeight: duplicateHighlightId===item.id? 700: undefined, boxShadow: duplicateHighlightId===item.id? '0 0 0 2px #fbbf24 inset': undefined, transition:'background .3s, box-shadow .3s' }}>
                        {magicSelectMode && (
                          <input type="checkbox" checked={selected} onChange={()=>toggleMagicSelect(item.id)} style={{ margin:0 }} />
                        )}
                        <span style={{ fontSize:12, flex:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.text}</span>
                          {item.copied && (
                            <span title="已複製" aria-label="已複製" style={{ width:16, height:16, display:'flex', alignItems:'center', justifyContent:'center', color:'#16a34a', fontSize:12, fontWeight:700 }}>✓</span>
                          )}
                          {item.lang==='ja' ? (
                            <span style={{ width:22, height:22, clipPath:'polygon(50% 0,100% 100%,0 100%)', background:'#fde68a', color:'#111', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>日</span>
                          ) : (
                            <span style={{ width:22, height:22, background:'#bfdbfe', borderRadius:4, color:'#111', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>英</span>
                          )}
                        {!magicSelectMode && <button style={{ background:'#aaa', padding:'2px 4px' }} onClick={()=>removeFromMagicBag(item.id)}>x</button>}
                      </div>
                    );
                  })}
                </div>
              );
            };
            return (
              <>
                <div style={{ marginTop:0, display:'flex', flexDirection:'column', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                    <h2 style={{ fontSize:16, margin:0 }}>Magic Bag</h2>
                    <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                      <select value={magicFilter} onChange={e=>{
                        const v = (e.target.value==='ja'?'ja': e.target.value==='en'?'en':'all');
                        setMagicFilter(v);
                        setSelectedMagic(prev => new Set([...prev].filter(id => {
                          const item = magicBag.find(m=>m.id===id);
                          if (!item) return false;
                          return v==='all' || item.lang===v;
                        })));
                      }} style={{ fontSize:11, padding:'2px 4px' }}>
                        <option value="all">全部</option>
                        <option value="ja">日文</option>
                        <option value="en">英文</option>
                      </select>
                      <select value={magicOrder} onChange={e=>setMagicOrder(e.target.value as any)} style={{ fontSize:11, padding:'2px 4px' }}>
                        <option value="newest">新→舊</option>
                        <option value="oldest">舊→新</option>
                        <option value="hardToEasy">沒印象→熟悉</option>
                        <option value="easyToHard">熟悉→沒印象</option>
                      </select>
                      <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:11 }}>
                        <input type="checkbox" checked={includeCopied} onChange={e=>setIncludeCopied(e.target.checked)} />包含已複製
                      </label>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {!magicSelectMode && <>
                      {magicBag.length>0 && <button style={{ background:'#2563eb', padding:'4px 6px' }} onClick={copyAllMagic}>複製全部</button>}
                      {magicBag.length>0 && <button style={{ background:'#f59e0b', padding:'4px 6px' }} onClick={copyAndAppendMagicToPrompt}>複製並加入prompt</button>}
                      {magicBag.length>0 && <button style={{ background:'#6366f1', padding:'4px 6px' }} onClick={()=>setMagicSelectMode(true)}>選取</button>}
                      {magicBag.length>0 && <button style={{ background:'#dc2626', padding:'4px 6px' }} onClick={clearMagicBag}>清空</button>}
                    </>}
                    {magicSelectMode && <>
                      <button style={{ background:'#334155', padding:'4px 6px' }} onClick={()=>{ copySelectedMagic(); }}>複製已選({selectedMagic.size})</button>
                      <button style={{ background:'#dc2626', padding:'4px 6px' }} disabled={!selectedMagic.size} onClick={deleteSelectedMagic}>刪除已選({selectedMagic.size})</button>
                      <button style={{ background:'#0d9488', padding:'4px 6px' }} onClick={selectAllMagic}>全選</button>
                      <button style={{ background:'#aaa', padding:'4px 6px' }} onClick={exitMagicSelectMode}>取消</button>
                    </>}
                  </div>
                </div>
                <div className="hint" style={{ marginTop:4, fontSize:11 }}>拖入下方區域即可複製；未來也會支援點擊文章底線詞加入。</div>
                {magicNotice && <div className="hint" style={{ marginTop:4, fontSize:12, fontWeight:700, color:'#b91c1c', background:'#fee2e2', padding:'4px 6px', borderRadius:4, border:'1px solid #fecaca' }}>{magicNotice}</div>}
                <Bag />
              </>
            );
          })()}
        </aside>
  </div>
  </DndContext>
    </main>
  );
}
