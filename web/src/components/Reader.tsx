import { useMemo, useState } from 'react';
import type { Block } from '../types';
import { boxLabels } from '../App';

// 簡單閱讀高亮：使用者貼上文章內容，依據 box 顏色做底線
// box1: 紅、box2: 橙、box3: 綠
const colors: Record<string, string> = {
  box1: '#ef4444', // red-500
  box2: '#f59e0b', // amber-500
  box3: '#10b981', // emerald-500
};

export function Reader({ blocks }: { blocks: Block[] }) {
  const [article, setArticle] = useState('');
  const dictByBox = useMemo(() => {
    return {
      box1: blocks.filter(b => b.box === 'box1').map(b => b.text).filter(Boolean),
      box2: blocks.filter(b => b.box === 'box2').map(b => b.text).filter(Boolean),
      box3: blocks.filter(b => b.box === 'box3').map(b => b.text).filter(Boolean),
    } as const;
  }, [blocks]);

  const highlighted = useMemo(() => {
    // 將每個 box 的詞用 span 包起來，套用對應顏色的底線
    let html = article;
    // 先長詞後短詞，避免短詞把長詞切開
    const replaceList: Array<{word: string, cls: string, color: string, lang: 'en'|'ja'|'unknown'}> = [];
    (['box1','box2','box3'] as const).forEach(box => {
      const list = [...new Set(blocks.filter(b => b.box===box).map(b => ({ word: b.text, lang: b.lang })))]
        .sort((a,b)=>b.word.length-a.word.length);
      list.forEach(({word,lang}) => replaceList.push({ word, lang: (lang as any), cls: `occ occ-${box}`, color: colors[box] }));
    });
    for (const { word, cls, color, lang } of replaceList) {
      if (!word) continue;
      const safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 英文用整字邊界，避免 'o' 把 hello 裡的 o 都畫底線
      const pattern = (lang === 'en') ? `\\b${safe}\\b` : safe;
      const re = new RegExp(pattern, 'g');
      html = html.replace(re, `<span class=\"${cls}\" style=\"text-decoration: underline; text-decoration-color: ${color}; text-decoration-thickness: 2px; text-underline-offset: 2px;\">${word}</span>`);
    }
    return html;
  }, [article, dictByBox]);

  return (
    <main className="grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
      <section className="panel">
        <h2>閱讀高亮</h2>
        <textarea value={article} onChange={e=>setArticle(e.target.value)} placeholder="貼上文章內容..." style={{ height: 160 }} />
        <div className="hint">顏色：{boxLabels.box1}=紅、{boxLabels.box2}=橙、{boxLabels.box3}=綠</div>
      </section>
      <section className="panel">
        <h2>文章</h2>
        <div dangerouslySetInnerHTML={{ __html: highlighted }} style={{ lineHeight: 1.8 }} />
      </section>
    </main>
  );
}
