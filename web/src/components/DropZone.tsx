import { useDroppable } from '@dnd-kit/core';
import type { PropsWithChildren } from 'react';

type Props = PropsWithChildren<{ id: string; title: string }>;

export function DropZone({ id, title, children }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={`panel zone ${isOver ? 'drag-over' : ''}`}>
      <h2>{title}</h2>
      <ul className="list">{children}</ul>
    </section>
  );
}