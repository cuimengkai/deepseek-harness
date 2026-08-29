/**
 * One develop-mode insight tab. All five tabs share this component; the
 * registration injects which section to render. The tab reads the session's
 * committed project-insight document through the controller store, folds the
 * four wire statuses into frame copy, and renders the section. The two
 * dependency sections render as a full-bleed dependency graph with a floating
 * complete list over the canvas and a floating content drawer for the
 * selected file (both directions stay in sync); the four inventory surfaces
 * render as the left-tree/right-detail explorer — the selected row's JSON
 * payload through the shiki-highlighted `CodeBlock`, and any row whose file
 * the shared documents pool carries as that file's content.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CodeBlock, MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  AgentTechSection, ComponentDependenciesSection, ComponentsSection,
  FileContentRow, ModuleTopologySection, ProjectInsightDoc, TechStackSection,
} from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import type { ProjectInsightState } from './insight-store.ts'
import type { NS } from './locales.ts'
import { TopologyGraph } from './TopologyGraph.tsx'
import { deriveComponentGraph, deriveModuleGraph, type SectionGraph } from './graph.ts'
import {
  deriveAgentTechInventoryTree, deriveComponentsTree, deriveMarkdownRowsTree, derivePathRowsTree,
  deriveTechStackTree,
} from './tree.ts'
import type { InventoryTreeNode } from './tree.ts'
import { isMarkdownPath, langOfPath } from './fileType.ts'
import { TreeExplorer } from './TreeExplorer.tsx'
import css from './insight.module.css'

/** The five rendered sections, one per tab. */
export type InsightSectionKey =
  | 'moduleTopology'
  | 'componentDependencies'
  | 'techStack'
  | 'components'
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

/** The shared documents pool keyed by root-relative path. */
type ContentByPath = ReadonlyMap<string, FileContentRow>

/** Localized chrome for a Markdown document rendered from a committed row. */
function markdownLabelsOf(t: SectionTranslate): MarkdownLabels {
  return {
    code: { copyLabel: t('label.copy'), copiedLabel: t('label.copied') },
    footnotes: t('markdown.footnotes'),
  }
}

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
    return <Frame>{t('frame.error')}: {state.error}</Frame>
  }
  if (state.status === 'loading') return <Frame busy>{t('frame.scanning')}</Frame>
  if (state.status === 'none') return <Frame>{t('frame.none')}</Frame>
  if (state.status === 'stale') return <Frame busy>{t('frame.stale')}</Frame>
  if (state.status !== 'ready' || state.doc === null) return null
  return <SectionBody variant={variant} doc={state.doc} t={t} />
}

/**
 * One non-content frame state (loading, re-scanning, unscanned, unreadable),
 * centered in the tab area the way the app's other loading states present. A
 * busy frame adds the shared spinner and announces itself politely.
 * @param props - the busy flag and the frame copy.
 * @returns the centered frame block.
 */
function Frame({ busy = false, children }: { busy?: boolean; children: ReactNode }) {
  return (
    <div className={css.frame} role="status" aria-live={busy ? 'polite' : undefined}>
      {busy && <span className={css.frameSpinner} aria-hidden="true" />}
      <span>{children}</span>
    </div>
  )
}

/**
 * Dispatch one registered variant to its section renderer, deriving the shared
 * documents pool every tab's content views resolve through.
 */
function SectionBody({
  variant, doc, t,
}: { variant: InsightSectionKey; doc: ProjectInsightDoc; t: SectionTranslate }) {
  const sections = doc.sections
  const contentByPath = useMemo(
    () => new Map(sections.documents.files.map(row => [row.path, row] as const)),
    [sections.documents],
  )
  switch (variant) {
    case 'moduleTopology':
      return (
        <ModuleTopologyBody section={sections.moduleTopology} contentByPath={contentByPath} t={t} />
      )
    case 'componentDependencies':
      return (
        <ComponentDependenciesBody
          section={sections.componentDependencies} contentByPath={contentByPath} t={t}
        />
      )
    case 'techStack':
      return <TechStackBody section={sections.techStack} contentByPath={contentByPath} t={t} />
    case 'components':
      return <ComponentsBody section={sections.components} contentByPath={contentByPath} t={t} />
    case 'agentTech':
      return <AgentTechBody section={sections.agentTech} contentByPath={contentByPath} t={t} />
  }
}

/* ── dependency graphs: full-bleed canvas + floating complete list ────────── */

function ModuleTopologyBody({
  section, contentByPath, t,
}: { section: ModuleTopologySection; contentByPath: ContentByPath; t: SectionTranslate }) {
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
      scope="module"
      contentByPath={contentByPath}
      t={t}
    />
  )
}

function ComponentDependenciesBody({
  section, contentByPath, t,
}: { section: ComponentDependenciesSection; contentByPath: ContentByPath; t: SectionTranslate }) {
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
      scope="component"
      contentByPath={contentByPath}
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
 * the complete file/component list floating over the canvas's left edge and
 * the selected file's content drawer floating over its right edge. List hover
 * and click drive the canvas hover ring and selection; canvas node hover and
 * tap drive the list row highlight and scroll-back. Selecting a row or node
 * opens the content drawer (embedded content when the documents pool carries
 * the file, otherwise the row's JSON); closing the drawer or tapping the
 * background clears the selection. Rows outside the bounded node set stay
 * listed but dimmed and inert. A section with no rendered edge set falls back
 * to the tree explorer over the full row list instead of a canvas.
 */
function GraphBody({
  graph, rows, aliases, note, scope, contentByPath, t,
}: {
  graph: SectionGraph
  rows: readonly ListRow[]
  aliases: readonly { readonly key: string; readonly value: string }[] | undefined
  note: ReactNode
  scope: string
  contentByPath: ContentByPath
  t: SectionTranslate
}) {
  const [listOpen, setListOpen] = useState(true)
  const [hoverPath, setHoverPath] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const nodeLabel = useMemo(
    () => new Map(graph.nodes.map(node => [node.id, node.label])),
    [graph.nodes],
  )
  const listRoots = useMemo(() => derivePathRowsTree(rows, scope), [rows, scope])
  const selectedRow = useMemo(
    () => (selectedPath === null ? undefined : rows.find(row => row.path === selectedPath)),
    [rows, selectedPath],
  )

  if (graph.edges.length === 0) {
    // No rendered edge set: the explorer over the full row list instead of a
    // canvas, with the aliases note appended (the tree has no alias rows).
    const aliasNote = aliases === undefined || aliases.length === 0 ? null : (
      <span className={css.muted}>
        {t('label.aliases')}: {aliases.map(alias => `${alias.key} → ${alias.value}`).join(', ')}
      </span>
    )
    return (
      <TreeExplorer
        roots={listRoots}
        note={<>{note}{aliasNote}</>}
        t={t}
        renderLeafDetail={node => renderRowDetail(node, contentByPath, t)}
      />
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
        {selectedPath !== null && (
          <FloatingDetail
            path={selectedPath}
            row={selectedRow}
            contentByPath={contentByPath}
            onClose={() => { setSelectedPath(null) }}
            t={t}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The selected file's content drawer floating over the graph canvas's right
 * edge: the embedded content when the documents pool carries the file
 * (markdown documents as markdown, other files as grammar-hinted source),
 * otherwise the row's JSON. Closing the drawer clears the selection.
 */
function FloatingDetail({
  path, row, contentByPath, onClose, t,
}: {
  path: string
  row: ListRow | undefined
  contentByPath: ContentByPath
  onClose: () => void
  t: SectionTranslate
}) {
  const content = fileContentNode(path, contentByPath, t)
  return (
    <aside className={css.detailOverlay}>
      <header className={css.listHeader}>
        <span className={css.detailTitle}>{path}</span>
        <button type="button" className={css.listClose} aria-label={t('label.closeDetail')} onClick={onClose}>
          ×
        </button>
      </header>
      <div className={css.detailBody}>
        {content ?? (row !== undefined && (
          <CodeBlock
            code={JSON.stringify(row, null, 2)}
            lang="json"
            copyLabel={t('label.copy')}
            copiedLabel={t('label.copied')}
          />
        ))}
      </div>
    </aside>
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

/* ── inventory sections: the left-tree/right-detail explorer ─────────────── */

/**
 * The tech-stack tab as the tree explorer: four fixed level-1 groups (runtimes,
 * manifests, dependencies, source files), dependencies grouped by manifest
 * category and source files by language. The right pane renders the selected
 * group's JSON, or a file row's embedded content when the documents pool
 * carries the file (runtime and dependency rows always render their JSON —
 * they are not files).
 */
function TechStackBody({
  section, contentByPath, t,
}: { section: TechStackSection; contentByPath: ContentByPath; t: SectionTranslate }) {
  if (section.manifests.length === 0 && section.dependencies.length === 0
    && section.runtimes.length === 0 && section.files.length === 0) {
    return <p className={css.empty}>{t('empty')}</p>
  }
  const roots = useMemo(() => deriveTechStackTree(section, {
    runtimes: t('label.runtimes'),
    manifests: t('label.manifests'),
    dependencies: t('label.dependencies'),
    sourceFiles: t('label.sourceFiles'),
  }), [section, t])
  return (
    <TreeExplorer
      roots={roots}
      t={t}
      renderLeafDetail={node => renderRowDetail(node, contentByPath, t)}
    />
  )
}

/**
 * The components tab as the tree explorer: one directory group per component's
 * parent directory, one leaf per component. The note reports the section's
 * total against the emitted rows; a leaf renders its file's embedded content
 * when the documents pool carries it, otherwise its row JSON.
 */
function ComponentsBody({
  section, contentByPath, t,
}: { section: ComponentsSection; contentByPath: ContentByPath; t: SectionTranslate }) {
  if (section.components.length === 0) return <p className={css.empty}>{t('empty')}</p>
  const roots = useMemo(() => deriveComponentsTree(section), [section])
  const note = (
    <span className={css.muted}>{t('label.count', { count: String(section.count) })}</span>
  )
  return (
    <TreeExplorer
      roots={roots}
      note={note}
      t={t}
      renderLeafDetail={node => renderRowDetail(node, contentByPath, t)}
    />
  )
}

/* ── agent-related tech: subtabs over inventory + markdown collections ────── */

/** The agent-tech second-level tabs: inventory plus the embedded markdown collections. */
type AgentTechSubTab = 'inventory' | 'skills' | 'mcp' | 'prompts'

/**
 * The agent-related tech tab: subtabs over the inventory and the embedded
 * content collections. Each subtab renders the tree explorer, which opts
 * into the composer overlay and owns its panes' scrollers, so the subtab row
 * stays pinned while the panes' content scrolls under it.
 */
function AgentTechBody({
  section, contentByPath, t,
}: { section: AgentTechSection; contentByPath: ContentByPath; t: SectionTranslate }) {
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
      {tab === 'inventory' && <AgentTechInventory section={section} contentByPath={contentByPath} t={t} />}
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

/**
 * The agent-tech inventory: the explorer over the role-grouped files and tools.
 * Selecting a file (or tool) row renders that file's embedded content — the
 * three markdown collections carry their rows' content, every other listed
 * file resolves through the shared documents pool — and a row whose content
 * neither carries falls back to its metadata JSON.
 */
function AgentTechInventory({
  section, contentByPath, t,
}: { section: AgentTechSection; contentByPath: ContentByPath; t: SectionTranslate }) {
  const roots = useMemo(() => deriveAgentTechInventoryTree(section, {
    kinds: {
      'agent-config': t('label.kind.agentConfig'),
      'tool-config': t('label.kind.toolConfig'),
      instructions: t('label.kind.instructions'),
      notes: t('label.kind.notes'),
      other: t('label.kind.other'),
    },
    tools: t('label.tools'),
  }), [section, t])
  // The collections' rows win over the shared pool (an MCP config's redacted
  // embed must never be shadowed by its verbatim source).
  const mergedContent = useMemo(() => {
    const map = new Map(contentByPath)
    for (const row of [...section.skills, ...section.mcp, ...section.prompts]) {
      map.set(row.path, row)
    }
    return map
  }, [section, contentByPath])
  // A subtab is reachable with an empty collection (the tab bar always
  // renders when the section has any content), so show the empty copy then.
  if (roots.length === 0) return <p className={css.empty}>{t('empty')}</p>
  const note = (
    <span className={css.muted}>{t('label.count', { count: String(section.count) })}</span>
  )
  return (
    <TreeExplorer
      roots={roots}
      note={note}
      t={t}
      renderLeafDetail={node => renderRowDetail(node, mergedContent, t)}
    />
  )
}

/**
 * One leaf row's content body shared by every tab: the row's file content
 * when the pool carries the file (a tool leaf resolves its referenced file's
 * content the same way), otherwise the row's metadata JSON. A row without a
 * `path` (a runtime, a dependency entry) always renders its JSON.
 * @param node - the selected leaf; its payload is the committed row.
 * @param contentByPath - every embedded content row keyed by path.
 * @param t - the bound namespace translator.
 * @returns the content view, or the metadata JSON fallback.
 */
function renderRowDetail(
  node: InventoryTreeNode,
  contentByPath: ContentByPath,
  t: SectionTranslate,
): ReactNode {
  const row = node.detail as { readonly path?: string }
  if (row.path !== undefined) {
    const content = fileContentNode(row.path, contentByPath, t)
    if (content !== null) return content
  }
  return (
    <CodeBlock
      code={JSON.stringify(node.detail, null, 2)}
      lang="json"
      copyLabel={t('label.copy')}
      copiedLabel={t('label.copied')}
    />
  )
}

/**
 * A file's embedded-content view, or `null` when the document pool excluded
 * the file: markdown documents through `MarkdownText`, other files through
 * the grammar-hinted `CodeBlock`.
 */
function fileContentNode(
  path: string,
  contentByPath: ContentByPath,
  t: SectionTranslate,
): ReactNode {
  const row = contentByPath.get(path)
  if (row === undefined) return null
  return isMarkdownPath(path)
    ? <MarkdownText text={row.content} labels={markdownLabelsOf(t)} />
    : (
      <CodeBlock
        code={row.content}
        lang={langOfPath(path)}
        copyLabel={t('label.copy')}
        copiedLabel={t('label.copied')}
      />
    )
}

/* ── the shared document-tree markdown viewer ─────────────────────────────── */

/**
 * One embedded markdown collection: the tree explorer over the collection's
 * documents — the left pane groups them by directory, and the right pane
 * renders the selected document's path and content (fenced code blocks carry
 * the shiki highlight). An empty collection shows the empty state. Shared by
 * the agent-tech subtabs.
 */
function MarkdownViewer({
  rows, t,
}: { rows: readonly FileContentRow[]; t: SectionTranslate }) {
  const roots = useMemo(() => deriveMarkdownRowsTree(rows, 'markdown'), [rows])
  if (rows.length === 0) return <p className={css.empty}>{t('empty')}</p>
  return (
    <TreeExplorer
      roots={roots}
      t={t}
      renderLeafDetail={(node) => {
        // The markdown derivation stores the document row as the leaf payload.
        const row = node.detail as FileContentRow
        return (
          <>
            <p className={css.markdownPath}>{row.path}</p>
            <MarkdownText text={row.content} labels={markdownLabelsOf(t)} />
          </>
        )
      }}
    />
  )
}
