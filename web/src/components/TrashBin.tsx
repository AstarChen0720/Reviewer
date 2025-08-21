import { useDroppable } from '@dnd-kit/core';

export function TrashBin() {
  const { setNodeRef, isOver } = useDroppable({ id: 'trash' });
  return (
    <section ref={setNodeRef} className={`panel trash ${isOver ? 'trash-over' : ''}`}>
      <h2>🗑️ Trash</h2>
      <p className="hint">把不要的項目拖到這裡刪除</p>
    </section>
  );
}
