export type Box = 'stash' | 'box1' | 'box2' | 'box3' | 'trash';

export type Block = {
  id: string;
  text: string;
  lang: 'ja' | 'en' | 'unknown';
  kind: 'vocab' | 'grammar' | 'unknown';
  box: Box;
  position: number;
  updatedAt?: number; // 本地最後更新時間 (ms)
  deleted?: boolean;  // 軟刪除標記供同步
};

export type Article = {
  id: string;
  createdAt: number;
  lang: Block['lang'];
  raw: string; // 原始文字
  html: string; // 高亮後 HTML
  usedBlockIds: string[]; // 有出現在文章中的 block id
  updatedAt?: number;
  deleted?: boolean;
};

