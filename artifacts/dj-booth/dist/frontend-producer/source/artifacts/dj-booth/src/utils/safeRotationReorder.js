// Reordering is not an instruction to end the active entertainer's set.
export function safeRotationReorder(proposed, activeId, movedId, destinationIndex) {
  const order = [...proposed];
  const same = (a, b) => String(a) === String(b);
  if (activeId == null || !order.some(id => same(id, activeId))) {
    return { ok: false, error: 'The on-stage entertainer must remain in rotation' };
  }
  if (destinationIndex === 0 && movedId != null && !same(movedId, activeId)) {
    const movedIndex = order.findIndex(id => same(id, movedId));
    if (movedIndex < 0) return { ok: false, error: 'Entertainer is no longer in rotation' };
    const [moved] = order.splice(movedIndex, 1);
    order.splice(order.findIndex(id => same(id, activeId)) + 1, 0, moved);
  }
  return { ok: true, rotation: order, currentIndex: order.findIndex(id => same(id, activeId)) };
}
