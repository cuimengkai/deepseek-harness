/**
 * The composer's plugin palette: the deployment's installed plugins, grouped by
 * spine category and searchable. A card carries the display name, a category
 * badge, the inventory's one-line description, and the mono module specifier;
 * it is dragged onto the canvas or clicked to append (touch and keyboard). A
 * module already in the composition reads as spent.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ComposePalette, PaletteModule } from './section-store.ts'
import type { AgentPresetSettingsKey } from './locales.ts'
import css from './AgentPresetComposer.module.css'

/**
 * A restrained, token-based color per spine category. Only the most salient
 * categories get a hue; the rest share a neutral so the badge never invents
 * one. Unknown categories (user-installed plugins) get the same neutral.
 */
const CATEGORY_COLORS: Readonly<Record<string, string>> = {
  tool: 'var(--dsw-alias-state-business-primary)',
  model: 'var(--dsw-alias-state-warn-primary)',
  security: 'var(--dsw-alias-state-error-primary)',
  capability: 'var(--dsw-alias-state-success-primary)',
  skill: 'var(--dsw-alias-state-success-primary)',
  agent: 'var(--dsw-alias-state-business-primary)',
  subagent: 'var(--dsw-alias-state-success-primary)',
  workflow: 'var(--dsw-alias-state-business-primary)',
}

/**
 * The token color that marks a spine category, for the glyph and badge.
 * @param category - the inventory's category, when it named one.
 * @returns a `--dsw-alias-*` color to render the category with.
 */
export function categoryColor(category: string | undefined): string {
  return category === undefined
    ? 'var(--dsw-alias-label-dimmed)'
    : CATEGORY_COLORS[category] ?? 'var(--dsw-alias-label-dimmed)'
}

/**
 * The monogram a pipeline node shows in its glyph: the display name's first
 * letter, or a dot when nothing recognizable remains.
 * @param text - the display name or module name.
 * @returns a single uppercase letter or the bullet fallback.
 */
export function glyphLetter(text: string): string {
  return text.trim().charAt(0).toUpperCase() || '•'
}

/** Palette props. */
export interface ComposerPaletteProps {
  /** The palette's last load; null only before the composer opened. */
  palette: ComposePalette | null
  /** Module names already in the composition, which read as spent. */
  inComposition: ReadonlySet<string>
  /** Append a module to the composition (the click path). */
  onAdd: (moduleName: string) => void
  /** Announce a palette drag in flight, so the canvas shows a copy slot. */
  onDragModule: () => void
  /** Collapse the overlay panel back to its canvas-edge tab. */
  onCollapse: () => void
  /** Active Web locale lookup. */
  t: (key: AgentPresetSettingsKey) => string
}

/**
 * Render the palette: search box, then the grouped, annotated module cards.
 * @param props - palette state and the add/drag/collapse callbacks.
 * @returns the palette panel.
 */
export function ComposerPalette(props: ComposerPaletteProps): ReactNode {
  const { palette, inComposition, onAdd, onDragModule, onCollapse, t } = props
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const offered = palette === null || palette.status !== 'ready'
    ? []
    : palette.modules.filter(module =>
      module.moduleName.toLowerCase().includes(query)
      || module.displayName.toLowerCase().includes(query)
      || module.category !== undefined && module.category.toLowerCase().includes(query)
      || module.description !== undefined && module.description.toLowerCase().includes(query))

  // Group by category in first-seen order; modules the inventory did not
  // categorize share the Other bucket, which is never a real category.
  const other = t('paletteCategoryOther')
  const groups: Array<{ key: string; modules: PaletteModule[] }> = []
  const byKey = new Map<string, PaletteModule[]>()
  for (const module of offered) {
    const key = module.category ?? other
    let list = byKey.get(key)
    if (list === undefined) {
      list = []
      byKey.set(key, list)
      groups.push({ key, modules: list })
    }
    list.push(module)
  }

  return (
    <aside className={css.paletteZone}>
      <div className={css.paletteHead}>
        <h3 className={css.columnHead}>{t('palette')}</h3>
        <button
          type="button"
          className={css.paletteToggle}
          aria-label={t('paletteCollapse')}
          title={t('paletteCollapse')}
          onClick={onCollapse}
        >
          ‹
        </button>
      </div>
      <input
        className={css.search}
        value={search}
        spellCheck={false}
        placeholder={t('paletteSearch')}
        onChange={(event) => { setSearch(event.target.value) }}
      />
      {palette === null || palette.status === 'loading'
        ? <p className={css.paletteNote}>{t('paletteLoading')}</p>
        : palette.status === 'unavailable'
          ? <p className={css.paletteNote}>{t('paletteUnavailable')}</p>
          : offered.length === 0
            ? <p className={css.paletteNote}>{t('paletteEmpty')}</p>
            : (
              <div className={css.paletteGroups}>
                {groups.map(group => (
                  <section key={group.key} className={css.paletteGroup}>
                    <h4 className={css.paletteGroupHead}>{group.key}</h4>
                    <ul className={css.paletteList}>
                      {group.modules.map((module) => {
                        const added = inComposition.has(module.moduleName)
                        return (
                          <li
                            key={module.moduleName}
                            className={added ? `${css.paletteCard} ${css.paletteCardAdded}` : css.paletteCard}
                            draggable={!added}
                            aria-disabled={added}
                            title={added ? t('alreadyAdded') : t('paletteHint')}
                            onDragStart={(event) => {
                              if (added) return
                              event.dataTransfer.setData('text/plain', module.moduleName)
                              event.dataTransfer.effectAllowed = 'copy'
                              onDragModule()
                            }}
                            onClick={() => { if (!added) onAdd(module.moduleName) }}
                          >
                            <span
                              className={css.paletteGlyph}
                              aria-hidden="true"
                              style={{ backgroundColor: categoryColor(module.category) }}
                            />
                            <span className={css.paletteBody}>
                              <span className={css.paletteName}>
                                {module.displayName}
                                {module.category === undefined
                                  ? null
                                  : <span className={css.paletteBadge}>{module.category}</span>}
                              </span>
                              {module.description === undefined
                                ? null
                                : <span className={css.paletteDesc}>{module.description}</span>}
                              <code className={css.paletteModule}>{module.moduleName}</code>
                            </span>
                            {added ? <span className={css.paletteAdded}>{t('rowAdded')}</span> : null}
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
    </aside>
  )
}
