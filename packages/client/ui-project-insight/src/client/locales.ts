/** `projectInsight` namespace dictionaries (five view tab labels + frame copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'projectInsight'

/** The project-insight dictionary key set (the source of truth for both locales). */
export type ProjectInsightKey =
  | 'view.modules'
  | 'view.componentDeps'
  | 'view.techStack'
  | 'view.components'
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
  | 'label.kind.agentConfig'
  | 'label.kind.toolConfig'
  | 'label.kind.instructions'
  | 'label.kind.notes'
  | 'label.kind.other'
  | 'label.count'
  | 'label.fullList'
  | 'label.capped'
  | 'label.list'
  | 'label.imports'
  | 'label.notInGraph'
  | 'label.close'
  | 'label.closeDetail'
  | 'label.copy'
  | 'label.copied'
  | 'markdown.footnotes'
  | 'subtab.inventory'
  | 'subtab.skills'
  | 'subtab.mcp'
  | 'subtab.prompts'

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
  'label.kind.agentConfig': '代理配置',
  'label.kind.toolConfig': '工具配置',
  'label.kind.instructions': '指令',
  'label.kind.notes': '笔记',
  'label.kind.other': '其他',
  'label.count': '{count} 项',
  'label.fullList': '完整列表',
  'label.capped': '图表已截断 — 省略 {nodes} 个节点、{edges} 条边',
  'label.list': '列表',
  'label.imports': '导入 {count} 项',
  'label.notInGraph': '未在图中',
  'label.close': '收起列表',
  'label.closeDetail': '关闭',
  'label.copy': '复制',
  'label.copied': '复制成功',
  'markdown.footnotes': '脚注',
  'subtab.inventory': '清单',
  'subtab.skills': '技能',
  'subtab.mcp': 'MCP',
  'subtab.prompts': '提示词',
}

/** English dictionary. */
export const en: Record<ProjectInsightKey, string> = {
  'view.modules': 'Module dependency topology',
  'view.componentDeps': 'Component dependency',
  'view.techStack': 'Tech stack',
  'view.components': 'Components',
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
  'label.kind.agentConfig': 'Agent config',
  'label.kind.toolConfig': 'Tool config',
  'label.kind.instructions': 'Instructions',
  'label.kind.notes': 'Notes',
  'label.kind.other': 'Other',
  'label.count': '{count} items',
  'label.fullList': 'Full list',
  'label.capped': 'Graph capped — {nodes} nodes and {edges} edges omitted',
  'label.list': 'List',
  'label.imports': '{count} imports',
  'label.notInGraph': 'not in graph',
  'label.close': 'Collapse list',
  'label.closeDetail': 'Close',
  'label.copy': 'Copy',
  'label.copied': 'Copied',
  'markdown.footnotes': 'Footnotes',
  'subtab.inventory': 'Inventory',
  'subtab.skills': 'Skills',
  'subtab.mcp': 'MCP',
  'subtab.prompts': 'Prompts',
}
