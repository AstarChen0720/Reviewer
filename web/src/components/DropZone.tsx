import { useDroppable } from '@dnd-kit/core';
import type { PropsWithChildren } from 'react';

type Props = PropsWithChildren<{
  id: string;
  title: string;
  colorClass?: string; // zone-box1 / zone-box2 / zone-box3 for styling
  search?: string;
  onSearchChange?: (v: string) => void;
  showSearch?: boolean;
  actions?: React.ReactNode; // extra buttons (ex: 自動導入)
}>;

export function DropZone({ id, title, children, colorClass = '', search = '', onSearchChange, showSearch, actions }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={`panel zone ${colorClass} ${isOver ? 'drag-over' : ''}`}>
      <div className="zone-head">
        <h2>{title}</h2>
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          {showSearch && onSearchChange && (
            <input
              className="zone-search"
              placeholder="搜尋"
              value={search}
              onChange={e => onSearchChange(e.target.value)}
            />
          )}
          {actions}
        </div>
      </div>
      <ul className="list">{children}</ul>
    </section>
  );
}