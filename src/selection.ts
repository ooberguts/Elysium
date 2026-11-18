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

/** Touch mode keeps prior choices so multiple items can be selected without modifier keys. */
export function selectLibraryItem<T extends { id: string }>(
  items: T[],
  selected: ReadonlySet<string>,
  clicked: T,
  anchor: number,
  options: { touch: boolean; additive: boolean; range: boolean },
): Set<string> {
  const index = items.findIndex((item) => item.id === clicked.id);
  const next = new Set(options.touch || options.additive ? selected : []);
  if (options.range && index >= 0) {
    for (const item of items.slice(Math.min(anchor, index), Math.max(anchor, index) + 1))
      next.add(item.id);
  } else if (next.has(clicked.id)) next.delete(clicked.id);
  else next.add(clicked.id);
  return next;
}
