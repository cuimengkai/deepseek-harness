/**
 * The inspector's model-kind picker: one row per model kind, binding the kind
 * to a provider and a model chosen from the configured catalog rather than
 * typed. A kind with no binding routes the node's own default; either side of
 * a binding may name just the provider or just the model, inheriting the other.
 *
 * The catalog is null while no composer overlay is open, loading on a fresh
 * host answer, and unavailable when the host refuses or the transport dies —
 * each renders a distinct hint instead of a broken form.
 */

import type { ReactNode } from 'react'
import type { ModelKind, ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { FlowModelKindBinding } from '@deepseek-ai/dsh-flow/types'
import type { AgentPresetSettingsKey } from './locales.ts'
import type { ModelCatalog } from './section-store.ts'
import css from './AgentPresetComposer.module.css'

/** The model kinds the picker offers, in display order. */
export const FLOW_MODEL_KINDS: readonly ModelKind[] = ['text', 'image', 'audio', 'embedding']

/** The kind's display copy, resolved per row. */
const KIND_KEY: Record<ModelKind, AgentPresetSettingsKey> = {
  text: 'modelKindText',
  image: 'modelKindImage',
  audio: 'modelKindAudio',
  embedding: 'modelKindEmbedding',
}

/** Whether a catalog model serves a kind: an explicit list, or text by default. */
function servesKind(model: { kinds?: readonly ModelKind[] }, kind: ModelKind): boolean {
  return model.kinds === undefined ? kind === 'text' : model.kinds.includes(kind)
}

/** The provider groups that serve a kind, in catalog order. */
function providersForKind(catalog: ModelCatalog, kind: ModelKind): readonly ModelProviderGroup[] {
  return catalog.groups.filter(group => group.models.some(model => servesKind(model, kind)))
}

/** Picker props. */
export interface ModelKindPickerProps {
  /** The selected node's bound routes, absent until one is bound. */
  modelKinds: Readonly<Partial<Record<ModelKind, FlowModelKindBinding>>> | undefined
  /** The configured model catalog; null while no composer overlay is open. */
  catalog: ModelCatalog | null
  /** Show the routes without the pickers (a shipped view). */
  readOnly?: boolean
  /** Bind one kind's route on the selected node. */
  onBinding: (kind: ModelKind, field: 'provider' | 'model', value: string) => void
  /** Active Web locale lookup. */
  t: (key: AgentPresetSettingsKey) => string
}

/**
 * Render the model-kind picker: a kind row per configured route.
 * @param props - the node's routes, the catalog, and the binding action.
 * @returns the model section.
 */
export function ModelKindPicker(props: ModelKindPickerProps): ReactNode {
  const { modelKinds, catalog, readOnly = false, onBinding, t } = props
  const servingKinds = catalog !== null && catalog.status === 'ready'
    ? FLOW_MODEL_KINDS.filter(kind => providersForKind(catalog, kind).length > 0)
    : []
  return (
    <section className={css.modelKinds}>
      <h4 className={css.inspectorSubhead}>{t('modelKinds')}</h4>
      {catalog === null || catalog.status === 'loading'
        ? <p className={css.modelMuted}>{t('modelKindsLoading')}</p>
        : catalog.status !== 'ready'
          ? <p className={css.modelMuted}>{t('modelKindsUnavailable')}</p>
          : servingKinds.length === 0
            ? <p className={css.modelMuted}>{t('modelKindsUnavailable')}</p>
            : servingKinds.map(kind => (
              <ModelKindRow
                key={kind}
                kind={kind}
                binding={modelKinds?.[kind]}
                catalog={catalog}
                readOnly={readOnly}
                onBinding={onBinding}
                t={t}
              />
            ))}
    </section>
  )
}

/** One model kind's route: label, provider picker, model picker. */
function ModelKindRow(props: {
  kind: ModelKind
  binding: FlowModelKindBinding | undefined
  catalog: ModelCatalog
  readOnly: boolean
  onBinding: ModelKindPickerProps['onBinding']
  t: ModelKindPickerProps['t']
}): ReactNode {
  const { kind, binding, catalog, readOnly, onBinding, t } = props
  const label = t(KIND_KEY[kind])
  const providers = providersForKind(catalog, kind)
  const providerGroup = binding?.provider === undefined
    ? undefined
    : catalog.groups.find(group => group.id === binding.provider)
  const models = providerGroup === undefined
    ? []
    : providerGroup.models.filter(model => servesKind(model, kind))

  if (readOnly) {
    const provider = binding?.provider
    const model = binding?.model
    const text = provider === undefined && model === undefined
      ? t('modelKindInherit')
      : [
        provider === undefined ? t('modelKindInherit') : providerGroup?.name ?? provider,
        model === undefined ? t('modelKindInherit') : providerGroup?.models.find(candidate => candidate.id === model)?.name ?? model,
      ].join(' / ')
    return (
      <div className={css.modelKindRow}>
        <span className={css.modelKindLabel}>{label}</span>
        <span className={css.modelMuted}>{text}</span>
      </div>
    )
  }

  return (
    <div className={css.modelKindRow}>
      <span className={css.modelKindLabel}>{label}</span>
      <select
        className={css.modelKindSelect}
        aria-label={`${label} · ${t('modelKindProvider')}`}
        value={binding?.provider ?? ''}
        onChange={(event) => {
          onBinding(kind, 'provider', event.target.value)
          // A route is a provider/model pair: a new provider invalidates the
          // model bound under the old one.
          onBinding(kind, 'model', '')
        }}
      >
        <option value="">{t('modelKindInherit')}</option>
        {providers.map(group => (
          <option key={group.id} value={group.id}>{group.name}</option>
        ))}
      </select>
      <select
        className={css.modelKindSelect}
        aria-label={`${label} · ${t('modelKindModel')}`}
        value={binding?.model ?? ''}
        disabled={providerGroup === undefined}
        onChange={(event) => { onBinding(kind, 'model', event.target.value) }}
      >
        <option value="">{t('modelKindInherit')}</option>
        {models.map(model => (
          <option key={model.id} value={model.id}>{model.name}</option>
        ))}
      </select>
    </div>
  )
}
