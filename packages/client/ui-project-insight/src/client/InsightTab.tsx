/**
 * One develop-mode insight tab. All six tabs share this component; the
 * registration injects which section to render. The tab reads the session's
 * committed `project-insight.json` through the controller store, folds the
 * four wire statuses into frame copy, and renders the section's rows.
 */

import { useEffect } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AgentTechSection, ComponentDependenciesSection, ComponentsSection, ModuleTopologySection,
  ProjectInsightDoc, PromptsSection, TechStackSection,
} from '@deepseek-ai/dsh-project-insight/src/schema.ts'
import type { ProjectInsightState } from './insight-store.ts'
import type { NS } from './locales.ts'
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
      return <PromptsBody section={sections.prompts} t={t} />
    case 'agentTech':
      return <AgentTechBody section={sections.agentTech} t={t} />
  }
}

function ModuleTopologyBody({ section, t }: { section: ModuleTopologySection; t: SectionTranslate }) {
  if (section.files.length === 0) return <p className={css.empty}>{t('empty')}</p>
  return (
    <div className={css.section}>
      <p className={css.muted}>
        {t('label.internalRoots')}: {section.internalRoots.join(', ')}
        {' · '}{t('label.externalPackages')}: {section.externalCount}
      </p>
      {section.aliases.map(alias => (
        <div key={alias.key} className={css.aliasRow}>
          <span>{alias.key}</span><span>→</span><span>{alias.value}</span>
        </div>
      ))}
      {section.files.map(file => (
        <div key={file.path} className={css.row}>
          <span className={css.rowHead}>{file.path}</span>
          {file.imports.length > 0 && (
            <div className={css.badges}>
              {file.imports.map(imp => <span key={imp} className={css.badge}>{imp}</span>)}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ComponentDependenciesBody({
  section, t,
}: { section: ComponentDependenciesSection; t: SectionTranslate }) {
  if (section.components.length === 0) return <p className={css.empty}>{t('empty')}</p>
  return (
    <div className={css.section}>
      {section.components.map(component => (
        <div key={component.path} className={css.row}>
          <span className={css.rowHead}>{component.path}</span>
          {component.imports.length > 0 && (
            <div className={css.badges}>
              {component.imports.map(imp => <span key={imp} className={css.badge}>{imp}</span>)}
            </div>
          )}
        </div>
      ))}
      {section.cycles.length > 0 && (
        <p className={css.muted}>
          {t('label.cycles')}: {section.cycles.map(([left, right]) => `${left} ↔ ${right}`).join(', ')}
        </p>
      )}
    </div>
  )
}

function TechStackBody({ section, t }: { section: TechStackSection; t: SectionTranslate }) {
  if (section.manifests.length === 0 && section.dependencies.length === 0) {
    return <p className={css.empty}>{t('empty')}</p>
  }
  return (
    <div className={css.section}>
      {section.runtimes.length > 0 && (
        <p className={css.muted}>
          {t('label.runtimes')}: {section.runtimes.map(runtime =>
            runtime.version === undefined ? runtime.name : `${runtime.name}@${runtime.version}`).join(', ')}
        </p>
      )}
      <p className={css.muted}>{t('label.manifests')}</p>
      {section.manifests.map(manifest => (
        <div key={manifest.path} className={css.aliasRow}>
          <span>{manifest.kind}</span><span className={css.muted}>{manifest.path}</span>
        </div>
      ))}
      <p className={css.muted}>{t('label.dependencies')}</p>
      {section.dependencies.map(dependency => (
        <div key={dependency.name} className={css.aliasRow}>
          <span>{dependency.name}</span>
          <span className={css.muted}>
            {dependency.version === undefined ? dependency.category : `${dependency.version} · ${dependency.category}`}
          </span>
        </div>
      ))}
      {section.files.length > 0 && (
        <>
          <p className={css.muted}>{t('label.sourceFiles')}</p>
          {section.files.map(file => (
            <div key={file.path} className={css.aliasRow}>
              <span>{file.language}</span>
              <span className={css.muted}>{file.path} · {file.lines}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function ComponentsBody({ section, t }: { section: ComponentsSection; t: SectionTranslate }) {
  if (section.components.length === 0) return <p className={css.empty}>{t('empty')}</p>
  return (
    <div className={css.section}>
      <p className={css.count}>{t('label.count', { count: String(section.count) })}</p>
      {section.components.map(component => (
        <div key={component.path} className={css.row}>
          <span className={css.rowHead}>{component.name} — {component.path}</span>
          <span className={css.muted}>
            {component.kind}
            {component.defaultExport && ` · ${t('label.defaultExport')}`}
            {component.hasProps && ` · ${t('label.hasProps')}`}
          </span>
        </div>
      ))}
    </div>
  )
}

function PromptsBody({ section, t }: { section: PromptsSection; t: SectionTranslate }) {
  if (section.files.length === 0) return <p className={css.empty}>{t('empty')}</p>
  return (
    <div className={css.section}>
      <p className={css.count}>{t('label.count', { count: String(section.count) })}</p>
      {section.files.map(file => (
        <div key={file.path} className={css.row}>
          <span className={css.rowHead}>{file.path}</span>
          <span className={css.muted}>
            {file.title === undefined ? `${file.bytes} B` : `${file.title} · ${file.bytes} B`}
          </span>
        </div>
      ))}
    </div>
  )
}

function AgentTechBody({ section, t }: { section: AgentTechSection; t: SectionTranslate }) {
  if (section.files.length === 0) return <p className={css.empty}>{t('empty')}</p>
  return (
    <div className={css.section}>
      <p className={css.count}>{t('label.count', { count: String(section.count) })}</p>
      {section.files.map(file => (
        <div key={file.path} className={css.row}>
          <span className={css.rowHead}>{file.path}</span>
          <span className={css.muted}>{file.kind}</span>
        </div>
      ))}
      {section.tools.length > 0 && (
        <>
          <p className={css.count}>{t('label.tools')}</p>
          {section.tools.map(tool => (
            <div key={`${tool.name}:${tool.path}`} className={css.aliasRow}>
              <span>{tool.name}</span><span className={css.muted}>{tool.path}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
