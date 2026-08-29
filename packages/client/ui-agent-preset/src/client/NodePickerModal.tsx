/**
 * The node picker: the modal that offers the installed plugins to add a node
 * after one on the canvas. It opens from a node's floating "+" (successor) or
 * an edge's midpoint "+" (insert between), offers the same search-and-group as
 * the palette, and disables the modules already in the composition — one agent
 * runs one instance of a plugin.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposePalette } from './section-store.ts'
import { filterAndGroupPalette } from './palette-group.ts'
import { categoryColor } from './ComposerPalette.tsx'
import type { AgentPresetSettingsKey } from './locales.ts'
import css from './AgentPresetComposer.module.css'

/** Node picker props. */
export interface NodePickerModalProps {
  /** The canvas node id the picked module will follow; the modal says which. */
  after: string
  /** The palette's last load; null only before the composer opened. */
  palette: ComposePalette | null
  /** Module names already in the composition, which read as spent. */
  inComposition: ReadonlySet<string>
  /** Insert a picked module after the anchor node. */
  onPick: (moduleName: string) => void
  /** Close the picker without adding. */
  onClose: () => void
  /** Active Web locale lookup. */
  t: (key: AgentPresetSettingsKey) => string
}

/**
 * Render the node picker: a search box over the grouped, annotated module
 * cards, with spent modules disabled. The modal chrome (mask click, Escape,
 * focus, aria) comes from the shared Modal.
 * @param props - the anchor node, palette state, and pick/close callbacks.
 * @returns the picker dialog.
 */
export function NodePickerModal(props: NodePickerModalProps): ReactNode {
  const { after, palette, inComposition, onPick, onClose, t } = props
  const [search, setSearch] = useState('')
  const groups = filterAndGroupPalette(palette, search, t('paletteCategoryOther'))
  return (
    <Modal
      open
      onClose={onClose}
      title={t('nodePickerTitle')}
      closeLabel={t('close')}
      description={`${t('nodePickerAfter')} ${after}`}
      className={css.pickerModal as string}
      contentClassName={css.pickerContent as string}
    >
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
          : groups.length === 0
            ? <p className={css.paletteNote}>{t('nodePickerEmpty')}</p>
            : (
              <div className={css.pickerGroups}>
                {groups.map(group => (
                  <section key={group.key} className={css.paletteGroup}>
                    <h4 className={css.paletteGroupHead}>{group.key}</h4>
                    <ul className={css.paletteList}>
                      {group.modules.map((module) => {
                        const added = inComposition.has(module.moduleName)
                        return (
                          <li key={module.moduleName}>
                            <button
                              type="button"
                              className={added ? `${css.pickerCard} ${css.paletteCardAdded}` : css.pickerCard}
                              disabled={added}
                              title={added ? t('alreadyAdded') : undefined}
                              onClick={() => {
                                /* v8 ignore next -- the button is disabled for spent modules, so the guard never refires */
                                if (!added) onPick(module.moduleName)
                              }}
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
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
    </Modal>
  )
}
