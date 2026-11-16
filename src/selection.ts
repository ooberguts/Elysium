/** A right click preserves a selection only when the clicked item belongs to it.
 * Deduplicate playlist entries; keep visible order ahead of selected filtered-out items. */
export function contextSelection<T extends { id: string }>(
  items: T[],
  selected: ReadonlySet<string>,
  clicked: T,
): T[] {
  if (!selected.has(clicked.id)) return [clicked];
  const seen = new Set<string>();
  const targets = items.filter((item) => {
    if (!selected.has(item.id) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return targets.length ? targets : [clicked];
}
