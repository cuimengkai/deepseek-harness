/**
 * The composer palette's search-and-group step: filter the ready inventory by a
 * query, then bucket the hits by spine category in first-seen order. Shared by
 * the palette panel and the node picker so both offer the same search match and
 * the same category order for a given inventory.
 */

import type { ComposePalette, PaletteModule } from './section-store.ts'

/** One category bucket of the offered palette: its label and the module cards. */
export interface PaletteGroup {
  /** The bucket's label — a real spine category, or the Other fallback. */
  key: string
  /** The offered modules in that category, in inventory order. */
  modules: PaletteModule[]
}

/**
 * Filter a palette by a search query and group the hits by category. Modules
 * the inventory did not categorize share the Other bucket, which is never a
 * real category.
 * @param palette - the palette's last load; null only before the composer opened.
 * @param query - the raw search text (whitespace-trimmed here).
 * @param otherLabel - the label for modules the inventory did not categorize.
 * @returns the category buckets in first-seen order; empty when the palette is
 * not ready or nothing matched.
 */
export function filterAndGroupPalette(
  palette: ComposePalette | null,
  query: string,
  otherLabel: string,
): PaletteGroup[] {
  const q = query.trim().toLowerCase()
  const offered = palette === null || palette.status !== 'ready'
    ? []
    : palette.modules.filter(module =>
      module.moduleName.toLowerCase().includes(q)
      || module.displayName.toLowerCase().includes(q)
      || module.category !== undefined && module.category.toLowerCase().includes(q)
      || module.description !== undefined && module.description.toLowerCase().includes(q))
  const groups: PaletteGroup[] = []
  const byKey = new Map<string, PaletteModule[]>()
  for (const module of offered) {
    const key = module.category ?? otherLabel
    let list = byKey.get(key)
    if (list === undefined) {
      list = []
      byKey.set(key, list)
      groups.push({ key, modules: list })
    }
    list.push(module)
  }
  return groups
}
