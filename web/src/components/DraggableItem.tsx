import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Block } from '../types';

export function DraggableItem({ block }: { block: Block }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li ref={setNodeRef} className={`item ${isDragging ? 'dragging' : ''}`} style={style} {...listeners} {...attributes}>
      <div className="text">{block.text}</div>
      <div className="meta">{block.lang} · {block.kind}</div>
    </li>
  );
}