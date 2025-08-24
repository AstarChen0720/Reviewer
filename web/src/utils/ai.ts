// Placeholder AI integration utilities.
// In the future replace mockGenerateArticle with real API call (e.g., fetch to OpenAI / Azure / etc.).

export interface AIGenerateResult {
  raw: string;
  html?: string; // optional if model already returns highlighted html
}

export async function mockGenerateArticle(prompt: string): Promise<AIGenerateResult> {
  // Simple mock: take first 20 non-empty vocab lines from the prompt JSON part (if present)
  // and weave into a dummy paragraph.
  const lines = prompt.split('\n');
  const vocab: string[] = [];
  for (const ln of lines) {
    const m = ln.match(/"text"\s*:\s*"(.*?)"/);
    if (m) vocab.push(m[1]);
    if (vocab.length >= 12) break;
  }
  const slice = vocab.slice(0, 12);
  if (!slice.length) {
    return { raw: 'No vocabulary available to generate mock article.' };
  }
  const half = Math.ceil(slice.length/2);
  const s1 = slice.slice(0, half).join(', ');
  const s2 = slice.slice(half).join(', ');
  const raw = `This is a mock AI article using: ${s1}. It then continues with ${s2} in a simple context.`;
  return { raw };
}

// Gemini API 呼叫
// 只做最基本的 JSON 輸出抽取，容錯: 若模型包成```或前後多餘文字，嘗試擷取第一個 { ... } JSON。
export async function generateWithGemini(params: { apiKey: string; model: string; prompt: string }): Promise<AIGenerateResult & { usedIds?: string[] }> {
  const { apiKey, model, prompt } = params;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      { role: 'user', parts: [{ text: prompt }]} as any
    ],
    generationConfig: {
      // 讓模型專注輸出 JSON，不特別調溫度 (可再加參數)
      temperature: 0.7,
    }
  };
  let text = '';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errTxt = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errTxt}`);
    }
    const data = await res.json();
    // 典型結構: data.candidates[0].content.parts[].text
    const parts = data?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      text = parts.map((p: any) => p.text || '').join('\n');
    } else {
      text = JSON.stringify(data);
    }
  } catch (e: any) {
    return { raw: `Gemini API 調用失敗: ${e.message || e}` };
  }
  // 嘗試萃取 JSON
  let jsonStr = text.trim();
  // 移除 ```json ``` 包裹
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  if (!jsonStr.startsWith('{')) {
    // 嘗試抓第一個 { ... } 區塊
    const m = jsonStr.match(/\{[\s\S]*\}/);
    if (m) jsonStr = m[0];
  }
  try {
    const parsed = JSON.parse(jsonStr);
    const raw = typeof parsed.raw === 'string' ? parsed.raw : (parsed.text || text);
    const html = typeof parsed.html === 'string' ? parsed.html : undefined;
    const usedIds: string[] | undefined = Array.isArray(parsed.usedIds) ? parsed.usedIds.filter((x: any)=>typeof x==='string') : undefined;
    return { raw, html, usedIds };
  } catch {
    // 解析失敗: 直接回傳原始文字
    return { raw: text };
  }
}

export function buildBasePrompt(params: {
  lang: 'ja'|'en';
  blocks: { id: string; text: string; box: string }[];
  targetSentences?: number; // still allow sentence hint
  style?: string;
  maxLength?: number; // characters for ja, words for en (default 500)
}): string {
  const { lang, blocks, targetSentences = 8, style = lang==='ja' ? '説明' : 'explanatory', maxLength = 500 } = params;
  const vocabJSON = JSON.stringify(blocks, null, 2);
  const baseHighlightRulesEn = `Highlighting rules:\n1. ONLY exact surface forms from the provided list may be wrapped.\n2. Wrap each actually used listed item with <span data-item-id=\"ID\">TEXT</span>.\n3. Do NOT wrap words not in the list.\n4. Inside the span, use the exact TEXT (no inflection changes). If a different form is needed, leave it unwrapped.\n5. Prefer including lower-familiarity items first (box1 then box2 then box3).\n6. Use each item at most twice unless strongly justified.`;
  const baseHighlightRulesJa = `ハイライト規則:\n1. 語彙リストにある表記と完全一致する出現のみ <span data-item-id=\"ID\">語</span> で囲む。\n2. 活用などで形が変わる場合は一致しなくなるなら囲まない。\n3. リスト外語を囲まない。\n4. span 内は元の語そのまま。\n5. 優先度: box1 → box2 → box3。\n6. 各語は多くても 2 回程度。`;

  if (lang === 'ja') {
    return `# 目的\n学習者向けに、読みやすく面白い日本語の文章を作成してください。\n文体: ${style}\n長さ: およそ 500 文字前後 (最大 ${maxLength} 文字)。文数は柔軟 (参考: 約 ${targetSentences} 文)。上限付近で自然に終了。\n語彙リスト(JSON):\n${vocabJSON}\n${baseHighlightRulesJa}\n\n# 出力フォーマット (JSON のみ)\n{\n  "raw": "span 無し本文",\n  "html": "raw と同一内容。対応語だけ <span data-item-id=ID>語</span>",\n  "usedIds": ["..."]\n}\n制約: 追加説明やマークダウン禁止。raw と html は span 以外同一。語が一つも自然に使えないなら usedIds を空配列に。`;
  }
  return `# Goal\nWrite an engaging, interesting English learning passage. Style: ${style}.\nLength: roughly 500 words (hard cap ${maxLength} words). Sentence count flexible (approx ${targetSentences}). Stop naturally near the limit.\nVocabulary list (JSON):\n${vocabJSON}\n${baseHighlightRulesEn}\n\n# Output (JSON ONLY)\n{\n  "raw": "Plain passage without spans",\n  "html": "Same passage but vocabulary wrapped with <span data-item-id=ID>TEXT</span>",\n  "usedIds": ["..."]\n}\nConstraints: No extra commentary or markdown. raw and html differ only by the span tags. If no vocabulary fits naturally, usedIds = [].`;
}
