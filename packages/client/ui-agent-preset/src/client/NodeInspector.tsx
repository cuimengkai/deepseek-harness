/**
 * The composer's inspector: details for the selected flow node. The canvas
 * floats it out over the workspace only while a node is selected, so the
 * inspector is where the full description, row id, and the reorder and remove
 * actions live on demand.
 */

import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposeRow, ModelKind } from '@deepseek-ai/dsh-api-remotes/client'
import type { FlowModelKindBinding } from '@deepseek-ai/dsh-flow/types'
import { displayNameFor, type ModelCatalog, type PaletteModule } from './section-store.ts'
import { categoryColor, glyphLetter } from './ComposerPalette.tsx'
import { ModelKindPicker } from './ModelKindPicker.tsx'
import type { AgentPresetSettingsKey } from './locales.ts'
import css from './AgentPresetComposer.module.css'

/** Inspector props. */
export interface NodeInspectorProps {
  /** The selected row; the composer mounts the inspector only with one. */
  row: ComposeRow
  /** The palette's annotation for the row's module, when the inventory knows it. */
  module: PaletteModule | undefined
  /** The selected node's per-kind model routes, absent until one is bound. */
  modelKinds: Readonly<Partial<Record<ModelKind, FlowModelKindBinding>>> | undefined
  /** The configured model catalog; null while no composer overlay is open. */
  catalog: ModelCatalog | null
  /** Bind one kind's route on the selected node (the inspector's model picker). */
  onModelBinding: (kind: ModelKind, field: 'provider' | 'model', value: string) => void
  canMoveUp: boolean
  canMoveDown: boolean
  /** Remove the selected node, by its row id or the module name when none was set. */
  onRemove: (id: string) => void
  /** Move the selected row one slot; -1 up, +1 down. */
  onMove: (delta: -1 | 1) => void
  /** Active Web locale lookup. */
  t: (key: AgentPresetSettingsKey) => string
  /** Show the details without the reorder/remove actions (a shipped view). */
  readOnly?: boolean
}

/**
 * Render the inspector: the selected node's details and actions.
 * @param props - the selected row, its annotation, and the actions.
 * @returns the inspector panel.
 */
export function NodeInspector(props: NodeInspectorProps): ReactNode {
  const { row, module, modelKinds, catalog, onModelBinding, canMoveUp, canMoveDown, onRemove, onMove, t, readOnly = false } = props
  return (
    <aside className={css.inspector}>
      <h3 className={css.columnHead}>{t('inspectorTitle')}</h3>
      <div className={css.inspectorBody}>
        <span
          className={css.nodeGlyph}
          aria-hidden="true"
          style={{ backgroundColor: categoryColor(module?.category) }}
        >
          {glyphLetter(module?.displayName ?? row.name)}
        </span>
        <span className={css.inspectorName}>
          {module?.displayName ?? displayNameFor(row.name)}
          {module?.category === undefined
            ? null
            : <span className={css.paletteBadge}>{module.category}</span>}
        </span>
        <code className={css.inspectorModule}>{row.name}</code>
        {module?.description === undefined
          ? null
          : <p className={css.inspectorDesc}>{module.description}</p>}
        {row.id === undefined
          ? null
          : (
            <p className={css.inspectorField}>
              <span className={css.fieldLabel}>{t('rowId')}</span>
              <code>{row.id}</code>
            </p>
          )}
        <ModelKindPicker
          modelKinds={modelKinds}
          catalog={catalog}
          readOnly={readOnly}
          onBinding={onModelBinding}
          t={t}
        />
        {readOnly
          ? null
          : (
            <div className={css.inspectorActions}>
              <Button variant="outline" disabled={!canMoveUp} onClick={() => { onMove(-1) }}>
                {t('moveUp')}
              </Button>
              <Button variant="outline" disabled={!canMoveDown} onClick={() => { onMove(1) }}>
                {t('moveDown')}
              </Button>
              <Button
                variant="outline"
                className={css.deleteConfirm}
                onClick={() => { onRemove(row.id ?? row.name) }}
              >
                {t('removeRow')}
              </Button>
            </div>
          )}
      </div>
    </aside>
  )
}
