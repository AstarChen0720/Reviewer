import { useEffect, useMemo, useState } from 'react';
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
  // 將來會由 AI 生成文章 -> 這裡暫時保留 state，但不提供輸入框
  const [article, setArticle] = useState('');

  // 開發/暫時使用：可在 console 呼叫 window.setArticle('內容') 注入文章
  useEffect(() => {
    (window as any).setArticle = (s: string) => setArticle(s);
    return () => { delete (window as any).setArticle; };
  }, []);
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
    <main className="reader-area">
      <section className="panel reader-panel">
        <h2 style={{ marginBottom: 4 }}>AI 文章閱讀</h2>
        <div className="legend hint" style={{ marginBottom: 12 }}>
          顏色：{boxLabels.box1}=紅、{boxLabels.box2}=橙、{boxLabels.box3}=綠
        </div>
        {article ? (
          <div className="article" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <div className="article empty">尚未載入文章。請在未來的「生成」功能產生內容或在 console 使用 setArticle('...') 注入測試。</div>
        )}
      </section>
    </main>
  );
}
