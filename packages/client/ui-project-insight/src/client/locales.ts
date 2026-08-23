/** `projectInsight` namespace dictionaries (six view tab labels + frame copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'projectInsight'

/** The project-insight dictionary key set (the source of truth for both locales). */
export type ProjectInsightKey =
  | 'view.modules'
  | 'view.componentDeps'
  | 'view.techStack'
  | 'view.components'
  | 'view.prompts'
  | 'view.agentTech'
  | 'frame.scanning'
  | 'frame.none'
  | 'frame.stale'
  | 'frame.error'
  | 'empty'
  | 'label.internalRoots'
  | 'label.aliases'
  | 'label.externalPackages'
  | 'label.runtimes'
  | 'label.manifests'
  | 'label.dependencies'
  | 'label.sourceFiles'
  | 'label.cycles'
  | 'label.tools'
  | 'label.count'
  | 'label.defaultExport'
  | 'label.hasProps'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The project-insight view tab labels and frame copy. */
    'projectInsight': ProjectInsightKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<ProjectInsightKey, string> = {
  'view.modules': '模块依赖拓扑图',
  'view.componentDeps': '组件依赖',
  'view.techStack': '技术栈',
  'view.components': '组件',
  'view.prompts': '提示词',
  'view.agentTech': 'Agent 相关技术',
  'frame.scanning': '正在扫描项目…',
  'frame.none': '该项目尚未扫描',
  'frame.stale': '项目已变化,正在重新扫描…',
  'frame.error': '无法读取项目洞察',
  'empty': '暂无数据',
  'label.internalRoots': '内部根',
  'label.aliases': '路径别名',
  'label.externalPackages': '外部包',
  'label.runtimes': '运行时',
  'label.manifests': '清单',
  'label.dependencies': '依赖',
  'label.sourceFiles': '源文件',
  'label.cycles': '循环依赖',
  'label.tools': '工具',
  'label.count': '{count} 项',
  'label.defaultExport': '默认导出',
  'label.hasProps': '有 props',
}

/** English dictionary. */
export const en: Record<ProjectInsightKey, string> = {
  'view.modules': 'Module dependency topology',
  'view.componentDeps': 'Component dependency',
  'view.techStack': 'Tech stack',
  'view.components': 'Components',
  'view.prompts': 'Prompts',
  'view.agentTech': 'Agent-related tech',
  'frame.scanning': 'Scanning project…',
  'frame.none': 'This project has not been scanned yet',
  'frame.stale': 'Project changed — re-scanning…',
  'frame.error': 'Could not read project insight',
  'empty': 'No data yet',
  'label.internalRoots': 'Internal roots',
  'label.aliases': 'Path aliases',
  'label.externalPackages': 'External packages',
  'label.runtimes': 'Runtimes',
  'label.manifests': 'Manifests',
  'label.dependencies': 'Dependencies',
  'label.sourceFiles': 'Source files',
  'label.cycles': 'Cycles',
  'label.tools': 'Tools',
  'label.count': '{count} items',
  'label.defaultExport': 'default export',
  'label.hasProps': 'has props',
}
