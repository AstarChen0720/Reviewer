export type Box = 'stash' | 'box1' | 'box2' | 'box3' | 'trash';

export type Block = {
  id: string;
  text: string;
  lang: 'ja' | 'en' | 'unknown';
  kind: 'vocab' | 'grammar' | 'unknown';
  box: Box;
  position: number;
};

export type Article = {
  id: string;
  createdAt: number;
  lang: Block['lang'];
  raw: string; // 原始文字
  html: string; // 高亮後 HTML
  usedBlockIds: string[]; // 有出現在文章中的 block id
};

