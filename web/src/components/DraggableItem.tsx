import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Block } from '../types';

type Props = {
  block: Block;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
};

export function DraggableItem({ block, selectable, selected, onToggleSelect }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      className={`item ${isDragging ? 'dragging' : ''} ${selectable ? 'selectable' : ''} ${selected ? 'selected' : ''}`}
      style={style}
      {...listeners}
      {...attributes}
    >
      {selectable && (
        <input
          type="checkbox"
          className="sel"
            checked={!!selected}
            onChange={(e) => { e.stopPropagation(); onToggleSelect?.(block.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ marginRight: 6 }}
        />
      )}
      <div className="text">{block.text}</div>
      <div className="meta">{block.lang} · {block.kind}</div>
    </li>
  );
}