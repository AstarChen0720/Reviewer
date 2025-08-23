export type Box = 'stash' | 'box1' | 'box2' | 'box3' | 'trash';

export type Block = {
  id: string;
  text: string;
  lang: 'ja' | 'en' | 'unknown';
  kind: 'vocab' | 'grammar' | 'unknown';
  box: Box;
  position: number;
};

