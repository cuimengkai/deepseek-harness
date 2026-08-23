/**
 * Flow-editor conversation view: a 2D dot-grid canvas of the session's flow
 * graph plus an inspector and a run surface. Nodes drag by their body and
 * connect by dragging from the right-edge port to a target node; condition and
 * loop sources take their branch labels (`true`/`false`, `body`/`after`)
 * automatically. A live run colors each node from the host's snapshot.
 */

import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowEdge, FlowNode, FlowNodeStatus } from '@deepseek-ai/dsh-flow/types'
import { FlowEditorController, RUN_INPUT_INVALID, type FlowModelKind, type PaletteNodeType } from './flow-store.ts'
import type { FlowEditorKey } from './locales.ts'
import { FlowCanvas, type FlowCanvasSurface } from './FlowCanvas.tsx'
import css from './FlowEditorView.module.css'

/** The model kinds the inspector offers. A plugin kind needs an explicit row here. */
const FLOW_MODEL_KINDS: readonly FlowModelKind[] = ['text', 'image', 'audio', 'embedding']
/** The palette's draggable node types, in display order. */
const PALETTE_TYPES: readonly PaletteNodeType[] = ['agent', 'condition', 'loop']
/** The palette data-transfer key carrying the dropped node type. */
const PALETTE_MIME = 'application/x-flow-node'
/** The palette chip label for each draggable node type. */
const PALETTE_LABELS: Record<PaletteNodeType, FlowEditorKey> = {
  agent: 'node.agent',
  condition: 'node.condition',
  loop: 'node.loop',
}

/** Status → run-status class on the node card. */
const STATUS_CLASS: Record<FlowNodeStatus, string | undefined> = {
  pending: css.statusPending,
  running: css.statusRunning,
  done: css.statusDone,
  failed: css.statusFailed,
  cancelled: css.statusCancelled,
}

/** Session-bound controls the flow canvas needs (the per-session controller). */
export interface FlowEditorViewInjected {
  controller: FlowEditorController
}

/** One node's presentation: type label, preview, and the run status when live. */
function nodePreview(node: FlowNode): string {
  switch (node.type) {
    case 'agent': return node.prompt
    case 'condition': return node.expression
    case 'loop': return `${node.iterable} → ${node.variable}`
    default: return ''
  }
}

/** The node-type dictionary key, localized at the call site. */
function nodeTypeLabel(node: FlowNode): FlowEditorKey {
  switch (node.type) {
    case 'start': return 'node.start'
    case 'end': return 'node.end'
    case 'agent': return 'node.agent'
    case 'condition': return 'node.condition'
    case 'loop': return 'node.loop'
  }
}

/** The full flow-editor view. */
export function FlowEditorView({
  controller, sessionId, useSessions, t,
}: ConvViewProps & InjectFace<FlowEditorViewInjected> & PropsLocale<'flowEditor'>) {
  const state = useSyncExternalStore(
    controller.store.subscribe.bind(controller.store),
    controller.store.getSnapshot.bind(controller.store),
  )
  const cwd = useSessions(snapshot => snapshot.byId[sessionId]?.cwd)

  useEffect(() => {
    void controller.load()
  }, [controller, cwd])

  const graph = state.graph
  const errorText = state.error === RUN_INPUT_INVALID ? t('run.inputInvalid') : state.error
  const readOnly = state.status === 'unavailable' || state.status === 'running'
    || state.status === 'loading' || state.status === 'error'
  const running = state.status === 'running'

  // The canvas face: the controller's snapshot plus its mutations routed
  // through the shared FlowCanvas surface.
  const surface: FlowCanvasSurface = {
    graph: state.graph,
    selectedNodeId: state.selectedNodeId,
    selectedEdgeId: state.selectedEdgeId,
    readOnly,
    selectNode: controller.selectNode.bind(controller),
    selectEdge: controller.selectEdge.bind(controller),
    moveNode: controller.moveNode.bind(controller),
    addEdge: controller.addEdge.bind(controller),
    removeNode: controller.removeNode.bind(controller),
    removeEdge: controller.removeEdge.bind(controller),
    addNodeAt: (data, position) => { controller.addNodeAt(data, position) },
  }

  /** The node wrapper's run-status accent, when a live run knows this node. */
  const nodeClass = useCallback((node: FlowNode): string | undefined => {
    const status = state.nodeStatuses?.[node.id]
    return status === undefined || status === null ? undefined : STATUS_CLASS[status]
  }, [state.nodeStatuses])

  /** The node card content: type, optional label, run-status dot, and preview. */
  const renderSessionNode = useCallback((node: FlowNode): ReactNode => {
    const status = state.nodeStatuses?.[node.id] ?? null
    return (
      <div className={css.nodeCard}>
        <div className={css.nodeHead}>
          <span className={css.nodeType}>{t(nodeTypeLabel(node))}</span>
          {node.label !== undefined && node.label !== ''
            && <span className={css.nodeLabel}>{node.label}</span>}
          {status !== null && <span className={css.nodeStatusDot} title={status} />}
        </div>
        <div className={css.nodePreview}>{nodePreview(node)}</div>
      </div>
    )
  }, [state.nodeStatuses, t])

  if (graph === null) {
    return (
      <div className={css.root} data-conversation-composer-overlay="">
        <div className={css.banner}>
          {state.status === 'unavailable' ? t('unavailable')
            : state.status === 'error' ? (errorText ?? t('loadError'))
              : state.status === 'running' ? t('run.running')
                : ''}
        </div>
      </div>
    )
  }

  const selectedNode = graph.nodes.find(node => node.id === state.selectedNodeId) ?? null
  const selectedEdge = graph.edges.find(edge => edge.id === state.selectedEdgeId) ?? null
  const runStatusText = state.run === null ? null
    : state.run.status === 'running' ? t('run.running')
      : state.run.status === 'completed' ? t('run.completed')
        : state.run.status === 'cancelled' ? t('run.cancelled')
          : t('run.error')

  return (
    <div className={css.root} data-conversation-composer-overlay="">
      <div className={css.toolbar}>
        <select
          className={css.flowSelect}
          value={state.flowId}
          disabled={readOnly}
          aria-label={t('view.flowEditor')}
          onChange={(e) => { if (e.target.value !== '') void controller.selectFlow(e.target.value) }}
        >
          <option value="" disabled>{t('view.flowEditor')}</option>
          {state.flows.map(flow => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
        </select>
        <button
          type="button"
          className={css.toolButton}
          disabled={readOnly}
          onClick={() => { controller.newFlow() }}
        >
          {t('toolbar.newFlow')}
        </button>
        <button
          type="button"
          className={css.toolButton}
          disabled={readOnly || state.flowId === ''}
          onClick={() => void controller.deleteFlow(state.flowId)}
        >
          {t('toolbar.deleteFlow')}
        </button>
        <span className={css.divider} />
        <button
          type="button"
          className={css.toolButton}
          disabled={readOnly}
          onClick={() => { controller.addNode('agent') }}
        >
          {t('toolbar.addAgent')}
        </button>
        <button
          type="button"
          className={css.toolButton}
          disabled={readOnly}
          onClick={() => { controller.addNode('condition') }}
        >
          {t('toolbar.addCondition')}
        </button>
        <button
          type="button"
          className={css.toolButton}
          disabled={readOnly}
          onClick={() => { controller.addNode('loop') }}
        >
          {t('toolbar.addLoop')}
        </button>
        <span className={css.divider} />
        <button
          type="button"
          className={`${css.toolButton} ${css.runButton}`}
          disabled={running || state.status === 'saving'}
          onClick={() => void controller.run()}
        >
          {t('toolbar.run')}
        </button>
        <button
          type="button"
          className={`${css.toolButton} ${css.stopButton}`}
          disabled={!running}
          onClick={() => void controller.stop()}
        >
          {t('toolbar.stop')}
        </button>
        <button
          type="button"
          className={css.toolButton}
          disabled={readOnly || state.status === 'saving' || !state.dirty}
          onClick={() => void controller.save()}
        >
          {state.dirty ? `${t('toolbar.save')} *` : t('toolbar.save')}
        </button>
        {state.dirty && <span className={css.unsavedBadge}>{t('toolbar.unsaved')}</span>}
      </div>

      {errorText !== null && <div className={css.errorStrip}>{errorText}</div>}
      {state.status === 'unavailable' && (
        <div className={css.noticeStrip}>{t('unavailable')}</div>
      )}

      <div className={css.body}>
        {!readOnly && (
          <div className={css.palette}>
            <div className={css.paletteTitle}>{t('palette.title')}</div>
            {PALETTE_TYPES.map(type => (
              <div
                key={type}
                className={css.paletteItem}
                draggable
                role="button"
                aria-label={t(PALETTE_LABELS[type])}
                data-node-type={type}
                onPointerDown={(e) => { e.stopPropagation() }}
                onDragStart={(e) => {
                  e.dataTransfer.setData(PALETTE_MIME, type)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
              >
                {t(PALETTE_LABELS[type])}
              </div>
            ))}
          </div>
        )}
        <FlowCanvas
          surface={surface}
          renderNode={renderSessionNode}
          nodeClass={nodeClass}
          dropMime={PALETTE_MIME}
          canvasHint={t('canvas.hint')}
          connectAriaLabel={t('view.flowEditor')}
        />

        <aside className={css.inspector}>
          {selectedNode !== null ? (
            <NodeInspector
              node={selectedNode}
              controller={controller}
              t={t}
              readOnly={readOnly}
            />
          ) : selectedEdge !== null ? (
            <EdgeInspector edge={selectedEdge} controller={controller} t={t} />
          ) : (
            <p className={css.inspectorHint}>{t('inspector.hint')}</p>
          )}

          <div className={css.runSurface}>
            <label className={css.fieldLabel}>{t('run.input')}</label>
            <textarea
              className={css.inputBox}
              value={state.inputText}
              disabled={running}
              spellCheck={false}
              onChange={(e) => { controller.setInputText(e.target.value) }}
            />
            {state.run !== null && (
              <div className={css.runSummary}>
                <span className={css.runStatus}>{runStatusText}</span>
                <span>{`${t('run.agentsStarted')}: ${state.run.agentsStarted}`}</span>
              </div>
            )}
            <div className={css.sectionTitle}>{t('run.history')}</div>
            {state.runs.length === 0 ? (
              <p className={css.emptyLine}>{t('run.noRuns')}</p>
            ) : (
              <ul className={css.runsList}>
                {state.runs.map(run => (
                  <li key={run.runId} className={css.runRow}>
                    <span className={css.runFlow}>{run.flowName}</span>
                    <span>{run.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

/** The per-type editable fields of the selected node. */
function NodeInspector({
  node, controller, t, readOnly,
}: {
  node: FlowNode
  controller: FlowEditorController
  t: PropsLocale<'flowEditor'>['t']
  readOnly: boolean
}) {
  const label = node.label ?? ''
  const [provider, model] = node.type === 'agent'
    ? [node.agentOptions?.provider ?? '', node.agentOptions?.model ?? '']
    : ['', '']
  return (
    <div className={css.inspectorBlock}>
      <div className={css.inspectorTitle}>{t('inspector.node')}: {t(nodeTypeLabel(node))}</div>
      <label className={css.fieldLabel}>{t('inspector.label')}</label>
      <input
        className={css.inputBox}
        value={label}
        disabled={readOnly}
        onChange={(e) => { controller.updateNode(node.id, { label: e.target.value }) }}
      />
      {node.type === 'agent' && (
        <>
          <label className={css.fieldLabel}>{t('inspector.prompt')}</label>
          <textarea
            className={css.inputBox}
            rows={4}
            value={node.prompt}
            disabled={readOnly}
            onChange={(e) => { controller.updateNode(node.id, { prompt: e.target.value }) }}
          />
          <label className={css.fieldLabel}>{t('inspector.provider')}</label>
          <input
            className={css.inputBox}
            value={provider}
            disabled={readOnly}
            placeholder={t('node.agent')}
            onChange={(e) => { controller.updateAgentOptions(node.id, e.target.value, model) }}
          />
          <label className={css.fieldLabel}>{t('inspector.model')}</label>
          <input
            className={css.inputBox}
            value={model}
            disabled={readOnly}
            placeholder={t('node.agent')}
            onChange={(e) => { controller.updateAgentOptions(node.id, provider, e.target.value) }}
          />
          <div className={css.kindSection}>
            <span className={css.kindSectionTitle}>{t('inspector.modelKinds')}</span>
            {FLOW_MODEL_KINDS.map((kind) => {
              const bind = node.agentOptions?.modelKinds?.[kind]
              return (
                <div key={kind} className={css.kindRow}>
                  <span className={css.kindName}>{kind}</span>
                  <input
                    className={css.inputBox}
                    value={bind?.provider ?? ''}
                    disabled={readOnly}
                    placeholder={t('inspector.provider')}
                    onChange={(e) => {
                      controller.updateAgentModelKind(node.id, kind, 'provider', e.target.value)
                    }}
                  />
                  <input
                    className={css.inputBox}
                    value={bind?.model ?? ''}
                    disabled={readOnly}
                    placeholder={t('inspector.model')}
                    onChange={(e) => { controller.updateAgentModelKind(node.id, kind, 'model', e.target.value) }}
                  />
                </div>
              )
            })}
          </div>
        </>
      )}
      {node.type === 'condition' && (
        <>
          <label className={css.fieldLabel}>{t('inspector.expression')}</label>
          <input
            className={css.inputBox}
            value={node.expression}
            disabled={readOnly}
            onChange={(e) => { controller.updateNode(node.id, { expression: e.target.value }) }}
          />
        </>
      )}
      {node.type === 'loop' && (
        <>
          <label className={css.fieldLabel}>{t('inspector.iterable')}</label>
          <input
            className={css.inputBox}
            value={node.iterable}
            disabled={readOnly}
            onChange={(e) => { controller.updateNode(node.id, { iterable: e.target.value }) }}
          />
          <label className={css.fieldLabel}>{t('inspector.variable')}</label>
          <input
            className={css.inputBox}
            value={node.variable}
            disabled={readOnly}
            onChange={(e) => { controller.updateNode(node.id, { variable: e.target.value }) }}
          />
        </>
      )}
      {!readOnly && (
        <button
          type="button"
          className={`${css.toolButton} ${css.dangerButton}`}
          onClick={() => { controller.removeNode(node.id) }}
        >
          {t('inspector.deleteNode')}
        </button>
      )}
    </div>
  )
}

/** The selected edge: its branch label and a delete action. */
function EdgeInspector({
  edge, controller, t,
}: {
  edge: FlowEdge
  controller: FlowEditorController
  t: PropsLocale<'flowEditor'>['t']
}) {
  return (
    <div className={css.inspectorBlock}>
      <div className={css.inspectorTitle}>{t('inspector.edge')}</div>
      <label className={css.fieldLabel}>{t('inspector.branchLabel')}</label>
      <div className={css.edgeLabelValue}>{edge.label ?? '—'}</div>
      <button
        type="button"
        className={`${css.toolButton} ${css.dangerButton}`}
        onClick={() => { controller.removeEdge(edge.id) }}
      >
        {t('inspector.deleteEdge')}
      </button>
    </div>
  )
}
