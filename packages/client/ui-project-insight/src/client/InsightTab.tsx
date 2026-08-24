/**
 * One develop-mode insight tab. All six tabs share this component; the
 * registration injects which section to render. The tab reads the session's
 * committed project-insight document through the controller store, folds the
 * four wire statuses into frame copy, and renders the section. The two
 * dependency sections render as a full-bleed dependency graph with a floating
 * complete list over the canvas (both directions stay in sync); the inventory
 * sections render as cards and tables; prompts and the agent-tech markdown
 * collections render as a document tab bar plus one markdown viewer.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AgentTechMarkdownRow, AgentTechSection, ComponentDependenciesSection, ComponentsSection,
  ModuleTopologySection, ProjectInsightDoc, TechStackSection,
} from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import type { ProjectInsightState } from './insight-store.ts'
import type { NS } from './locales.ts'
import { TopologyGraph } from './TopologyGraph.tsx'
import { deriveComponentGraph, deriveModuleGraph, type SectionGraph } from './graph.ts'
import css from './insight.module.css'

/** The six scanned sections, one per tab. */
export type InsightSectionKey =
  | 'moduleTopology'
  | 'componentDependencies'
  | 'techStack'
  | 'components'
  | 'prompts'
  | 'agentTech'

/** Business face of one insight tab registration. */
export interface InsightTabInjected {
  hooks: { projectInsight: SnapshotStore<ProjectInsightState> }
  load: () => void
  dispose: () => void
  /** Which of the six document sections this tab renders. */
  variant: InsightSectionKey
}

/** Full props of an insight tab: standard conversation-view kit + inject + locale. */
export type InsightTabProps =
  ConvViewProps & InjectFace<InsightTabInjected> & PropsLocale<typeof NS>

type SectionTranslate = TranslateNS<typeof NS>

/** One row of a dependency full list: a path and its rendered imports. */
interface ListRow {
  readonly path: string
  readonly imports: readonly string[]
}

/**
 * Renders one insight tab: load the session's document on mount, stop the
 * controller on unmount, and present the committed section (or frame copy
 * while the document is absent or being re-scanned).
 * @param props - composed conversation-view + inject + locale share.
 */
export function InsightTab({ useProjectInsight, load, dispose, variant, t }: InsightTabProps) {
  const state = useProjectInsight(snapshot => snapshot)
  useEffect(() => {
    load()
    return dispose
  }, [load, dispose])

  if (state.status === 'error') {
    return <p className={css.frame}>{t('frame.error')}: {state.error}</p>
  }
  if (state.status === 'loading') return <p className={css.frame}>{t('frame.scanning')}</p>
  if (state.status === 'none') return <p className={css.frame}>{t('frame.none')}</p>
  if (state.status === 'stale') return <p className={css.frame}>{t('frame.stale')}</p>
  if (state.status !== 'ready' || state.doc === null) return null
  return <SectionBody variant={variant} doc={state.doc} t={t} />
}

/** Dispatch one registered variant to its section renderer. */
function SectionBody({
  variant, doc, t,
}: { variant: InsightSectionKey; doc: ProjectInsightDoc; t: SectionTranslate }) {
  const sections = doc.sections
  switch (variant) {
    case 'moduleTopology':
      return <ModuleTopologyBody section={sections.moduleTopology} t={t} />
    case 'componentDependencies':
      return <ComponentDependenciesBody section={sections.componentDependencies} t={t} />
    case 'techStack':
      return <TechStackBody section={sections.techStack} t={t} />
    case 'components':
      return <ComponentsBody section={sections.components} t={t} />
    case 'prompts':
      return <PromptsBody doc={doc} t={t} />
    case 'agentTech':
      return <AgentTechBody section={sections.agentTech} t={t} />
  }
}

/* ── dependency graphs: full-bleed canvas + floating complete list ────────── */

function ModuleTopologyBody({ section, t }: { section: ModuleTopologySection; t: SectionTranslate }) {
  if (section.files.length === 0) return <p className={css.empty}>{t('empty')}</p>
  const graph = useMemo(() => deriveModuleGraph(section), [section])
  const note = (
    <span className={css.muted}>
      {t('label.internalRoots')}: {section.internalRoots.join(', ')}
      {' · '}{t('label.externalPackages')}: {section.externalCount}
    </span>
  )
  return (
    <GraphBody
      graph={graph}
      rows={section.files}
      aliases={section.aliases}
      note={note}
      t={t}
    />
  )
}

function ComponentDependenciesBody({
  section, t,
}: { section: ComponentDependenciesSection; t: SectionTranslate }) {
  if (section.components.length === 0) return <p className={css.empty}>{t('empty')}</p>
  const graph = useMemo(() => deriveComponentGraph(section), [section])
  const note = section.cycles.length > 0 ? (
    <span className={css.muted}>
      {t('label.cycles')}: {section.cycles.map(([left, right]) => `${left} ↔ ${right}`).join(', ')}
    </span>
  ) : null
  return (
    <GraphBody
      graph={graph}
      rows={section.components}
      aliases={undefined}
      note={note}
      t={t}
    />
  )
}

/** A one-line note naming what the graph caps dropped; nothing when uncapped. */
function GraphNote({ graph, t }: { graph: SectionGraph; t: SectionTranslate }) {
  if (graph.capped.nodes === 0 && graph.capped.edges === 0) return null
  return (
    <span className={css.muted}>
      {t('label.capped', { nodes: String(graph.capped.nodes), edges: String(graph.capped.edges) })}
    </span>
  )
}

/**
 * The shared dependency-graph body: a toolbar over a full-bleed canvas, with
 * the complete file/component list floating over the canvas. List hover and
 * click drive the canvas hover ring and selection; canvas node hover and tap
 * drive the list row highlight and scroll-back. Rows outside the bounded node
 * set stay listed but dimmed and inert.
 */
function GraphBody({
  graph, rows, aliases, note, t,
}: {
  graph: SectionGraph
  rows: readonly ListRow[]
  aliases: readonly { readonly key: string; readonly value: string }[] | undefined
  note: ReactNode
  t: SectionTranslate
}) {
  const [listOpen, setListOpen] = useState(true)
  const [hoverPath, setHoverPath] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const nodeLabel = useMemo(
    () => new Map(graph.nodes.map(node => [node.id, node.label])),
    [graph.nodes],
  )

  if (graph.edges.length === 0) {
    // No rendered edge set: fall back to the full list instead of a canvas.
    return (
      <div className={css.section}>
        <div className={css.sectionScroll}>
          {note}
          <FullList rows={rows} nodeLabel={nodeLabel} aliases={aliases} />
        </div>
      </div>
    )
  }

  return (
    <div className={css.graphRoot}>
      <div className={css.graphToolbar}>
        <div className={css.graphToolbarLeft}>
          {note}
          <GraphNote graph={graph} t={t} />
        </div>
        <div className={css.graphToolbarRight}>
          <button
            type="button"
            className={listOpen ? css.toolbarButtonActive : css.toolbarButton}
            onClick={() => { setListOpen(open => !open) }}
          >
            {t('label.list')} ({rows.length})
          </button>
        </div>
      </div>
      <div className={css.graphCanvas}>
        <TopologyGraph
          nodes={graph.nodes}
          edges={graph.edges}
          cycleNodeIds={graph.cycleNodeIds}
          hoverNodeId={hoverPath}
          selectedNodeId={selectedPath}
          onSelectNode={setSelectedPath}
          onHoverNode={setHoverPath}
          onTapBackground={() => { setSelectedPath(null) }}
        />
        {listOpen && (
          <FloatingList
            rows={rows}
            nodeLabel={nodeLabel}
            hoverPath={hoverPath}
            selectedPath={selectedPath}
            onHover={setHoverPath}
            onSelect={setSelectedPath}
            onClose={() => { setListOpen(false) }}
            t={t}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The complete list floating over the graph canvas. Every row of the full
 * section is listed; rows outside the rendered node set are dimmed with a
 * "not in graph" note and do not interact. Rows mirror the canvas state:
 * hover highlights the row and the node, click selects and centers the node.
 */
function FloatingList({
  rows, nodeLabel, hoverPath, selectedPath, onHover, onSelect, onClose, t,
}: {
  rows: readonly ListRow[]
  nodeLabel: ReadonlyMap<string, string>
  hoverPath: string | null
  selectedPath: string | null
  onHover: (path: string | null) => void
  onSelect: (path: string) => void
  onClose: () => void
  t: SectionTranslate
}) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  // A canvas tap selects a node; bring its row into view inside the overlay.
  useEffect(() => {
    if (selectedPath === null) return
    rowRefs.current.get(selectedPath)?.scrollIntoView({ block: 'nearest' })
  }, [selectedPath])
  return (
    <aside className={css.listOverlay}>
      <header className={css.listHeader}>
        <span>{t('label.fullList')} ({rows.length})</span>
        <button type="button" className={css.listClose} aria-label={t('label.close')} onClick={onClose}>
          ×
        </button>
      </header>
      <div className={css.listBody}>
        {rows.map((row) => {
          const inGraph = nodeLabel.has(row.path)
          const label = nodeLabel.get(row.path) ?? row.path
          const classes = [css.listRow]
          if (!inGraph) classes.push(css.listRowDim)
          if (selectedPath === row.path) classes.push(css.listRowSelected)
          if (hoverPath === row.path) classes.push(css.listRowHover)
          return (
            <div
              key={row.path}
              ref={(element) => { if (element !== null) rowRefs.current.set(row.path, element) }}
              className={classes.join(' ')}
              onMouseEnter={inGraph ? () => { onHover(row.path) } : undefined}
              onMouseLeave={inGraph ? () => { onHover(null) } : undefined}
              onClick={inGraph ? () => { onSelect(row.path) } : undefined}
            >
              <span className={css.listRowMain}>{label}</span>
              <span className={css.listRowMeta}>
                {!inGraph && t('label.notInGraph')}
                {inGraph && label !== row.path && <>{row.path} · </>}
                {inGraph && t('label.imports', { count: String(row.imports.length) })}
              </span>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

/** The full list used when no edge set renders: aliases, then one row each. */
function FullList({
  rows, nodeLabel, aliases,
}: {
  rows: readonly ListRow[]
  nodeLabel: ReadonlyMap<string, string>
  aliases: readonly { readonly key: string; readonly value: string }[] | undefined
}) {
  return (
    <>
      {aliases?.map(alias => (
        <div key={alias.key} className={css.aliasRow}>
          <span>{alias.key}</span><span>→</span><span>{alias.value}</span>
        </div>
      ))}
      {rows.map(row => (
        <div key={row.path} className={css.row}>
          <span className={css.rowHead}>{nodeLabel.get(row.path) ?? row.path}</span>
          {row.imports.length > 0 && (
            <div className={css.badges}>
              {row.imports.map(imp => <span key={imp} className={css.badge}>{imp}</span>)}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

/* ── inventory sections: cards and tables ────────────────────────────────── */

function TechStackBody({ section, t }: { section: TechStackSection; t: SectionTranslate }) {
  if (section.manifests.length === 0 && section.dependencies.length === 0
    && section.runtimes.length === 0 && section.files.length === 0) {
    return <p className={css.empty}>{t('empty')}</p>
  }
  return (
    <div className={css.section}>
      <div className={css.sectionScroll}>
        {section.runtimes.length > 0 && (
          <div className={css.card}>
            <div className={css.cardHead}>{t('label.runtimes')}</div>
            <div className={css.cardBody}>
              <div className={css.badges}>
                {section.runtimes.map(runtime => (
                  <span key={runtime.name} className={css.badge}>
                    {runtime.version === undefined ? runtime.name : `${runtime.name}@${runtime.version}`}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
        {section.manifests.length > 0 && (
          <div className={css.card}>
            <div className={css.cardHead}>{t('label.manifests')}</div>
            <div className={css.table}>
              <div className={css.tableRowHead}>
                <span>{t('label.kind')}</span><span>{t('label.path')}</span>
              </div>
              {section.manifests.map(manifest => (
                <div key={manifest.path} className={css.tableRow}>
                  <span className={css.badge}>{manifest.kind}</span>
                  <span className={css.muted}>{manifest.path}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {section.dependencies.length > 0 && (
          <div className={css.card}>
            <div className={css.cardHead}>{t('label.dependencies')}</div>
            <div className={css.table}>
              <div className={css.tableRowHead}>
                <span>{t('label.package')}</span><span>{t('label.versionScope')}</span>
              </div>
              {section.dependencies.map(dependency => (
                <div key={dependency.name} className={css.tableRow}>
                  <span className={css.tableRowMain}>{dependency.name}</span>
                  <span className={css.muted}>
                    {dependency.version === undefined
                      ? dependency.category
                      : `${dependency.version} · ${dependency.category}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {section.files.length > 0 && (
          <div className={css.card}>
            <div className={css.cardHead}>{t('label.sourceFiles')}</div>
            <div className={css.table}>
              <div className={css.tableRowHead}>
                <span>{t('label.language')}</span><span>{t('label.fileLines')}</span>
              </div>
              {section.files.map(file => (
                <div key={file.path} className={css.tableRow}>
                  <span className={css.badge}>{file.language}</span>
                  <span className={css.muted}>{file.path} · {file.lines}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ComponentsBody({ section, t }: { section: ComponentsSection; t: SectionTranslate }) {
  if (section.components.length === 0) return <p className={css.empty}>{t('empty')}</p>
  return (
    <div className={css.section}>
      <div className={css.sectionScroll}>
        <div className={css.card}>
          <div className={css.cardHead}>{t('label.count', { count: String(section.count) })}</div>
          <div className={css.table}>
            {section.components.map(component => (
              <div key={component.path} className={css.tableRow}>
                <div className={css.tableRowCol}>
                  <span className={css.tableRowMain}>{component.name}</span>
                  <span className={css.muted}>{component.path}</span>
                </div>
                <div className={css.badges}>
                  <span className={css.badge}>{component.kind}</span>
                  {component.defaultExport && <span className={css.badge}>{t('label.defaultExport')}</span>}
                  {component.hasProps && <span className={css.badge}>{t('label.hasProps')}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── prompts: document tabs plus the embedded markdown ────────────────────── */

/**
 * The prompts tab. The committed `prompts` section carries only metadata, so
 * the markdown comes from the agent-tech section's embedded prompt collection,
 * which the scanner fills through the same `isPromptFile` judgement — the two
 * tabs are the same logical set projected onto different presentations. The
 * count line reports the section's total against the embedded, rendered count.
 */
function PromptsBody({ doc, t }: { doc: ProjectInsightDoc; t: SectionTranslate }) {
  const section = doc.sections.prompts
  const embedded = doc.sections.agentTech.prompts
  if (section.files.length === 0 && embedded.length === 0) {
    return <p className={css.empty}>{t('empty')}</p>
  }
  const shown = embedded.length
  return (
    <div className={css.section}>
      {shown > 0 ? (
        <MarkdownViewer rows={embedded} t={t} />
      ) : (
        <div className={css.sectionScroll}>
          <div className={css.card}>
            <div className={css.cardHead}>{t('label.count', { count: String(section.count) })}</div>
            <div className={css.table}>
              {section.files.map(file => (
                <div key={file.path} className={css.tableRowCol}>
                  <span className={css.tableRowMain}>{file.title ?? file.path}</span>
                  <span className={css.muted}>{file.path} · {file.bytes} B</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <p className={css.footerNote}>
        {t('label.promptCount', { count: String(section.count), shown: String(shown) })}
      </p>
    </div>
  )
}

/* ── agent-related tech: subtabs over inventory + markdown collections ────── */

/** The agent-tech second-level tabs: inventory plus the embedded markdown collections. */
type AgentTechSubTab = 'inventory' | 'skills' | 'mcp' | 'prompts'

function AgentTechBody({ section, t }: { section: AgentTechSection; t: SectionTranslate }) {
  const [tab, setTab] = useState<AgentTechSubTab>(() => firstNonEmptyTab(section))
  if (section.files.length === 0 && section.skills.length === 0
    && section.mcp.length === 0 && section.prompts.length === 0) {
    return <p className={css.empty}>{t('empty')}</p>
  }
  const tabs: readonly { key: AgentTechSubTab; label: string; count: number }[] = [
    { key: 'inventory', label: t('subtab.inventory'), count: section.count },
    { key: 'skills', label: t('subtab.skills'), count: section.skills.length },
    { key: 'mcp', label: t('subtab.mcp'), count: section.mcp.length },
    { key: 'prompts', label: t('subtab.prompts'), count: section.prompts.length },
  ]
  return (
    <div className={css.section}>
      <div className={css.subTabs} role="tablist">
        {tabs.map(tabEntry => (
          <button
            key={tabEntry.key}
            type="button"
            role="tab"
            aria-selected={tab === tabEntry.key}
            className={tab === tabEntry.key ? css.subTabActive : css.subTab}
            onClick={() => { setTab(tabEntry.key) }}
          >
            {tabEntry.label} ({tabEntry.count})
          </button>
        ))}
      </div>
      {tab === 'inventory' && (
        <div className={css.sectionScroll}>
          <AgentTechInventory section={section} t={t} />
        </div>
      )}
      {tab === 'skills' && <MarkdownViewer rows={section.skills} t={t} />}
      {tab === 'mcp' && <MarkdownViewer rows={section.mcp} t={t} />}
      {tab === 'prompts' && <MarkdownViewer rows={section.prompts} t={t} />}
    </div>
  )
}

/** The first non-empty subtab, so a skills-only project opens on skills. */
function firstNonEmptyTab(section: AgentTechSection): AgentTechSubTab {
  if (section.files.length > 0) return 'inventory'
  if (section.skills.length > 0) return 'skills'
  if (section.mcp.length > 0) return 'mcp'
  return 'prompts'
}

/** The agent-tech inventory: the agent-related files and the tools they reference. */
function AgentTechInventory({ section, t }: { section: AgentTechSection; t: SectionTranslate }) {
  return (
    <>
      <div className={css.card}>
        <div className={css.cardHead}>{t('label.count', { count: String(section.count) })}</div>
        <div className={css.table}>
          {section.files.map(file => (
            <div key={file.path} className={css.tableRow}>
              <span className={css.tableRowMain}>{file.path}</span>
              <span className={css.badge}>{file.kind}</span>
            </div>
          ))}
        </div>
      </div>
      {section.tools.length > 0 && (
        <div className={css.card}>
          <div className={css.cardHead}>{t('label.tools')}</div>
          <div className={css.table}>
            {section.tools.map(tool => (
              <div key={`${tool.name}:${tool.path}`} className={css.tableRow}>
                <span className={css.tableRowMain}>{tool.name}</span>
                <span className={css.muted}>{tool.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/* ── the shared document-tab markdown viewer ──────────────────────────────── */

/**
 * One embedded markdown collection: a document tab bar over a single scrollable
 * markdown pane. A single document skips the tab bar; an empty collection shows
 * the empty state. Shared by the prompts tab and the agent-tech subtabs.
 */
function MarkdownViewer({
  rows, t,
}: { rows: readonly AgentTechMarkdownRow[]; t: SectionTranslate }) {
  const [active, setActive] = useState(0)
  if (rows.length === 0) return <p className={css.empty}>{t('empty')}</p>
  const index = Math.min(active, rows.length - 1)
  // rows.length is nonzero and index is clamped below it, so the row exists;
  // the guard only satisfies the array-index type.
  const current = rows[index]
  if (current === undefined) return null
  return (
    <div className={css.markdownBody}>
      {rows.length > 1 && (
        <div className={css.subTabs} role="tablist">
          {rows.map((row, rowIndex) => (
            <button
              key={row.path}
              type="button"
              role="tab"
              aria-selected={rowIndex === index}
              className={rowIndex === index ? css.subTabActive : css.subTab}
              onClick={() => { setActive(rowIndex) }}
            >
              {row.name}
            </button>
          ))}
        </div>
      )}
      <div className={css.markdownPanel}>
        <p className={css.markdownPath}>{current.path}</p>
        <MarkdownText text={current.markdown} />
      </div>
    </div>
  )
}
