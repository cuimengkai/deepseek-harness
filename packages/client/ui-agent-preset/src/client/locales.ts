/** Locale bundles for the agent-preset settings row, hero chip, header label, and management section. */

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | 'title' | 'description' | 'loading' | 'error' | 'userTrust' | 'seatHint' | 'seatKind' | 'headerHint'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view' | 'editCopy'
  | 'category.label' | 'category.office' | 'category.coding' | 'category.creative'
  | 'skill.label' | 'skill.scroll'
  | 'skill.office.docs' | 'skill.office.docs.draft'
  | 'skill.office.finance' | 'skill.office.finance.draft'
  | 'skill.office.data' | 'skill.office.data.draft'
  | 'skill.office.desk' | 'skill.office.desk.draft'
  | 'skill.office.slides' | 'skill.office.slides.draft'
  | 'skill.office.research' | 'skill.office.research.draft'
  | 'skill.coding.daily' | 'skill.coding.daily.draft'
  | 'skill.coding.web' | 'skill.coding.web.draft'
  | 'skill.coding.agent' | 'skill.coding.agent.draft'
  | 'skill.coding.skill' | 'skill.coding.skill.draft'
  | 'skill.coding.cicd' | 'skill.coding.cicd.draft'
  | 'skill.coding.docs' | 'skill.coding.docs.draft'
  | 'skill.creative.site' | 'skill.creative.site.draft'
  | 'skill.creative.ppt' | 'skill.creative.ppt.draft'
  | 'skill.creative.poster' | 'skill.creative.poster.draft'
  | 'skill.creative.app' | 'skill.creative.app.draft'
  | 'skill.creative.system' | 'skill.creative.system.draft'
  | 'skill.creative.brand' | 'skill.creative.brand.draft'
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetPtcName' | 'presetPtcDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'
  | 'presetOrchestrationSampleName' | 'presetOrchestrationSampleDescription'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'builtInGroup' | 'customGroup'
  | 'brokenBadge' | 'brokenNoCopy' | 'brokenNoCompose' | 'switchRefused'
  | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating'
  | 'compose' | 'composeTitle' | 'composeIntro' | 'newAgent'
  | 'handoff' | 'handoffHint'
  | 'palette' | 'paletteHint' | 'paletteSearch' | 'paletteLoading' | 'paletteUnavailable' | 'paletteEmpty'
  | 'compositionLabel' | 'canvasHint' | 'connectLabel'
  | 'canvasStart' | 'canvasEnd' | 'inspectorTitle' | 'rowId' | 'moveUp' | 'moveDown' | 'paletteCategoryOther'
  | 'modelKinds' | 'modelKindText' | 'modelKindImage' | 'modelKindAudio' | 'modelKindEmbedding'
  | 'modelKindProvider' | 'modelKindModel' | 'modelKindInherit' | 'modelKindsLoading' | 'modelKindsUnavailable'
  | 'paletteCollapse' | 'paletteExpand'
  | 'rowAdded' | 'alreadyAdded' | 'removeRow'
  | 'nodeAddLabel' | 'nodeInsertLabel' | 'nodePickerTitle' | 'nodePickerAfter' | 'nodePickerEmpty'
  | 'save' | 'saving' | 'noRows' | 'unchanged' | 'overwriteWarning' | 'back'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** English copy. */
export const en: Record<AgentPresetSettingsKey, string> = {
  title: 'Capabilities',
  description: 'Capability pack for sessions (tools and plugins). Scenarios in Orchestration bind a pack to a flow.',
  loading: 'Loading presets…',
  error: 'Could not load agent presets.',
  userTrust: 'Custom',
  seatHint: 'Capability pack for this session',
  seatKind: 'Capabilities',
  headerHint: 'Capability pack this session mounted',
  nav: 'Capabilities',
  'category.label': 'Task categories',
  'category.office': 'Everyday work',
  'category.coding': 'Code & build',
  'category.creative': 'Design & create',
  'skill.label': 'Suggested starters',
  'skill.scroll': 'Show more starters',
  'skill.office.docs': 'Documents',
  'skill.office.docs.draft': 'Help me draft and organize a document.',
  'skill.office.finance': 'Finance',
  'skill.office.finance.draft': 'Help me analyze this finance question.',
  'skill.office.data': 'Data & charts',
  'skill.office.data.draft': 'Help me analyze data and visualize it.',
  'skill.office.desk': 'Workbench',
  'skill.office.desk.draft': 'Help me set up a personal workbench for this task.',
  'skill.office.slides': 'Slides',
  'skill.office.slides.draft': 'Help me outline a slide deck.',
  'skill.office.research': 'Deep research',
  'skill.office.research.draft': 'Help me research this topic thoroughly.',
  'skill.coding.daily': 'Day-to-day coding',
  'skill.coding.daily.draft': 'Help me with day-to-day coding in this workspace.',
  'skill.coding.web': 'Web development',
  'skill.coding.web.draft': 'Help me build or fix a web feature.',
  'skill.coding.agent': 'Agent apps',
  'skill.coding.agent.draft': 'Help me design or implement an agent application.',
  'skill.coding.skill': 'Skill development',
  'skill.coding.skill.draft': 'Help me author or improve an agent skill.',
  'skill.coding.cicd': 'CI/CD',
  'skill.coding.cicd.draft': 'Help me improve CI/CD for this project.',
  'skill.coding.docs': 'Docs',
  'skill.coding.docs.draft': 'Help me write or update project documentation.',
  'skill.creative.site': 'Site design',
  'skill.creative.site.draft': 'Help me design a website layout and visual direction.',
  'skill.creative.ppt': 'PPT design',
  'skill.creative.ppt.draft': 'Help me design presentation slides.',
  'skill.creative.poster': 'Poster',
  'skill.creative.poster.draft': 'Help me design a visual poster.',
  'skill.creative.app': 'Mobile app',
  'skill.creative.app.draft': 'Help me design a mobile app experience.',
  'skill.creative.system': 'Design system',
  'skill.creative.system.draft': 'Help me define or extend a design system.',
  'skill.creative.brand': 'Brand design',
  'skill.creative.brand.draft': 'Help me explore brand design directions.',
  sectionIntro:
    'Step 1 of a scenario Agent: the plugin composition one session’s agent runs — tools, prompts, and capabilities. '
    + 'Assemble one from installed plugins, duplicate an existing pack, or let Creator draft one. '
    + 'Then open Orchestration to bind a pack to a flow.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  editCopy: 'Edit a copy',
  presetStandardName: 'Standard preset',
  presetStandardDescription:
    'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.',
  presetPtcName: 'PTC preset',
  presetPtcDescription:
    'All Standard preset capabilities, with tools exposed through the PTC mode SDK so the model can combine multi-step operations in one TypeScript program.',
  presetMinimalName: 'Minimal preset',
  presetMinimalDescription:
    'Two-tool coding agent with persistent bash and str_replace_editor.',
  presetCordisName: 'Creator preset',
  presetCordisDescription:
    'Built for creating custom agent presets, with all Standard preset capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.',
  presetOrchestrationSampleName: 'Sample · orchestration',
  presetOrchestrationSampleDescription:
    'Learning preset for orchestration modes: lean tools (shell, editor, ask_user) so the shipped hello-orchestration mode can teach flow branching. Copy before customizing.',
  duplicate: 'Duplicate',
  duplicateUnavailable: 'This deployment has no writable preset directory',
  delete: 'Delete',
  presetId: 'Identifier',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Name',
  displayNamePlaceholder: 'Shown in the picker; defaults to the identifier',
  inUse: 'In use',
  builtInGroup: 'Built-in',
  customGroup: 'Custom',
  noDescription: 'No description.',
  brokenBadge: 'Failed to load',
  brokenNoCopy: 'A preset that failed to load cannot be duplicated',
  brokenNoCompose: 'A preset that failed to load has no rows to edit',
  switchRefused: 'Could not switch to {name}: {reason}',
  copyOf: 'Copied from',
  cancel: 'Cancel',
  close: 'Close',
  retry: 'Retry',
  copyTitle: 'Duplicate preset',
  copyIntro:
    'The whole preset is copied on this machine. The identifier becomes its directory name and cannot '
    + 'be changed later; everything else is edited in the preset\'s own files.',
  create: 'Create',
  creating: 'Creating…',
  compose: 'Edit composition',
  composeTitle: 'Edit agent composition',
  composeIntro:
    'An agent is the plugin composition one session runs. Arrange installed plugins left to right as the '
    + 'pipeline that composes it, or hand the draft to Creator mode to build or refine it.',
  newAgent: 'New agent',
  handoff: 'Let the agent build on this',
  handoffHint: 'Save, then hand this draft to Creator mode to build or refine it.',
  palette: 'Plugins',
  paletteHint: 'Drag into the composition',
  paletteSearch: 'Search plugins',
  paletteLoading: 'Loading installed plugins…',
  paletteUnavailable: 'This deployment reports no plugin inventory, so nothing can be dragged in.',
  paletteEmpty: 'No installed plugins to add.',
  compositionLabel: 'Composition',
  canvasHint: 'Drag plugins in; connect a port to reorder; Delete removes.',
  connectLabel: 'Connect after this node',
  canvasStart: 'Start',
  canvasEnd: 'End',
  inspectorTitle: 'Plugin details',
  rowId: 'Row id',
  moveUp: 'Move up',
  moveDown: 'Move down',
  modelKinds: 'Models',
  modelKindText: 'Text',
  modelKindImage: 'Image',
  modelKindAudio: 'Audio',
  modelKindEmbedding: 'Embedding',
  modelKindProvider: 'Provider',
  modelKindModel: 'Model',
  modelKindInherit: 'Inherit node default',
  modelKindsLoading: 'Loading configured models…',
  modelKindsUnavailable: 'No configured models yet — add providers and models in Settings first.',
  paletteCategoryOther: 'Other',
  paletteCollapse: 'Collapse plugins',
  paletteExpand: 'Open plugins',
  rowAdded: 'Added',
  alreadyAdded: 'Already in the composition',
  removeRow: 'Remove',
  nodeAddLabel: 'Add a node after',
  nodeInsertLabel: 'Insert a node between',
  nodePickerTitle: 'Add a node',
  nodePickerAfter: 'Add after',
  nodePickerEmpty: 'No matching plugins.',
  save: 'Save',
  saving: 'Saving…',
  noRows: 'The composition needs at least one plugin.',
  unchanged: 'Nothing changed yet.',
  overwriteWarning: 'Saving overwrites this preset\'s existing composition.',
  back: 'Back',
  openLocation: 'Open folder',
  showLocation: 'Show location',
  revealedPathLabel: 'Preset files:',
  idRequired: 'Give the preset an identifier.',
  idInvalid: 'Use lowercase letters, digits, and hyphens, starting with a letter or digit.',
  idTaken: 'A preset with this identifier already exists.',
  deleteTitle: 'Delete this preset?',
  deleteDescription:
    'The preset directory is deleted. Sessions already running on it keep working; new sessions cannot select it.',
  deleteConfirm: 'Delete',
  deleting: 'Deleting…',
}

/** Simplified Chinese copy. */
export const zh: Record<AgentPresetSettingsKey, string> = {
  title: '能力',
  description: '会话使用的能力包（工具与插件）。编排里的场景会把能力包绑定到流程。',
  loading: '正在加载预设…',
  error: '无法加载 Agent 预设。',
  userTrust: '自定义',
  seatHint: '本会话的能力包',
  seatKind: '能力',
  headerHint: '本会话挂载的能力包',
  nav: '能力',
  'category.label': '任务分类',
  'category.office': '日常办公',
  'category.coding': '代码开发',
  'category.creative': '设计创意',
  'skill.label': '推荐起步',
  'skill.scroll': '查看更多起步项',
  'skill.office.docs': '文档处理',
  'skill.office.docs.draft': '帮我起草并整理一份文档。',
  'skill.office.finance': '金融服务',
  'skill.office.finance.draft': '帮我分析这个财务问题。',
  'skill.office.data': '数据分析及可视化',
  'skill.office.data.draft': '帮我分析数据并可视化。',
  'skill.office.desk': '个人工作台',
  'skill.office.desk.draft': '帮我为这项任务搭一个个人工作台。',
  'skill.office.slides': '幻灯片',
  'skill.office.slides.draft': '帮我梳理一份幻灯片大纲。',
  'skill.office.research': '深度研究',
  'skill.office.research.draft': '帮我深入调研这个主题。',
  'skill.coding.daily': '日常开发',
  'skill.coding.daily.draft': '帮我在这个工作区完成日常开发任务。',
  'skill.coding.web': '网站开发',
  'skill.coding.web.draft': '帮我开发或修复一个 Web 功能。',
  'skill.coding.agent': 'Agent 应用',
  'skill.coding.agent.draft': '帮我设计或实现一个 Agent 应用。',
  'skill.coding.skill': 'Skill 开发',
  'skill.coding.skill.draft': '帮我编写或改进一个 Agent Skill。',
  'skill.coding.cicd': 'CI/CD',
  'skill.coding.cicd.draft': '帮我改进这个项目的 CI/CD。',
  'skill.coding.docs': '文档',
  'skill.coding.docs.draft': '帮我撰写或更新项目文档。',
  'skill.creative.site': '网站设计',
  'skill.creative.site.draft': '帮我设计网站布局与视觉方向。',
  'skill.creative.ppt': 'PPT设计',
  'skill.creative.ppt.draft': '帮我设计演示文稿幻灯片。',
  'skill.creative.poster': '视觉海报',
  'skill.creative.poster.draft': '帮我设计一张视觉海报。',
  'skill.creative.app': '移动端App',
  'skill.creative.app.draft': '帮我设计一个移动端 App 体验。',
  'skill.creative.system': '设计系统',
  'skill.creative.system.draft': '帮我定义或扩展一套设计系统。',
  'skill.creative.brand': '品牌设计',
  'skill.creative.brand.draft': '帮我探索品牌设计方向。',
  sectionIntro:
    '场景 Agent 的第一步：一个会话的 Agent 所运行的插件组装——工具、提示词与能力。'
    + '从已安装插件组装、复制后改成自己的，或用「创造」让 Agent 起草。'
    + '然后打开「编排」把能力包绑到流程上。',
  builtIn: '内置',
  setDefault: '设为默认',
  view: '查看',
  editCopy: '编辑副本',
  presetStandardName: '标准预设',
  presetStandardDescription: '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。',
  presetPtcName: 'PTC 预设',
  presetPtcDescription: '具备标准预设的全部能力，并通过 PTC 模式 SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
  presetMinimalName: '极简预设',
  presetMinimalDescription: '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
  presetCordisName: '创造预设',
  presetCordisDescription: '用于创建自定义 Agent 预设：具备标准预设的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
  presetOrchestrationSampleName: '样本 · 编排',
  presetOrchestrationSampleDescription:
    '配合编排模式学习的精简预设（Shell、编辑器、ask_user），供内置 hello-orchestration 模式演示流程分支。请先复制再改。',
  duplicate: '复制',
  duplicateUnavailable: '此部署未配置可写的预设目录',
  delete: '删除',
  presetId: '标识符',
  presetIdPlaceholder: 'my-agent',
  displayName: '名称',
  displayNamePlaceholder: '选择器中显示的名字，缺省用标识符',
  inUse: '当前使用',
  builtInGroup: '内置',
  customGroup: '自定义',
  noDescription: '暂无描述。',
  brokenBadge: '加载失败',
  brokenNoCopy: '预设加载失败，不能复制',
  brokenNoCompose: '预设加载失败，没有可编辑的行',
  switchRefused: '无法切换到「{name}」：{reason}',
  copyOf: '复制自',
  cancel: '取消',
  close: '关闭',
  retry: '重试',
  copyTitle: '复制预设',
  copyIntro: '整个预设会在本机复制一份。标识符将成为目录名，事后无法更改；其余内容之后直接在预设自己的文件里编辑。',
  create: '创建',
  creating: '正在创建…',
  compose: '编辑组合',
  composeTitle: '编辑 Agent 组合',
  composeIntro: 'Agent 就是一个会话所运行的插件组装。把已安装的插件从左到右排成一条流水线，或把草稿交给「创造模式」搭建或完善。',
  newAgent: '新建 Agent',
  handoff: '让 Agent 帮我搭建/完善',
  handoffHint: '保存后交给「创造模式」搭建或完善。',
  palette: '插件',
  paletteHint: '拖入组合',
  paletteSearch: '搜索插件',
  paletteLoading: '正在加载已安装插件…',
  paletteUnavailable: '此部署没有提供插件清单，无法拖入插件。',
  paletteEmpty: '没有可添加的已安装插件。',
  compositionLabel: '组合',
  canvasHint: '把插件拖入画布；从节点端口拖到另一个节点以调整顺序；Delete 删除。',
  connectLabel: '把该节点接到此节点之后',
  canvasStart: '开始',
  canvasEnd: '结束',
  inspectorTitle: '插件详情',
  rowId: '行标识',
  moveUp: '上移',
  moveDown: '下移',
  modelKinds: '模型',
  modelKindText: '文本',
  modelKindImage: '图像',
  modelKindAudio: '音频',
  modelKindEmbedding: '向量',
  modelKindProvider: '提供商',
  modelKindModel: '模型',
  modelKindInherit: '继承节点默认',
  modelKindsLoading: '正在加载已配置的模型…',
  modelKindsUnavailable: '还没有配置模型，请先在设置中添加提供商与模型。',
  paletteCategoryOther: '其他',
  paletteCollapse: '收起插件',
  paletteExpand: '展开插件',
  rowAdded: '已添加',
  alreadyAdded: '已在组合中',
  removeRow: '移除',
  nodeAddLabel: '在其后添加节点',
  nodeInsertLabel: '在节点之间插入',
  nodePickerTitle: '添加节点',
  nodePickerAfter: '在其后添加',
  nodePickerEmpty: '没有匹配的插件。',
  save: '保存',
  saving: '正在保存…',
  noRows: '组合至少需要一个插件。',
  unchanged: '还没有改动。',
  overwriteWarning: '保存将覆盖该预设现有的组合。',
  back: '返回',
  openLocation: '打开目录',
  showLocation: '查看路径',
  revealedPathLabel: '预设文件：',
  idRequired: '请填写标识符。',
  idInvalid: '只能使用小写字母、数字与连字符，且以字母或数字开头。',
  idTaken: '该标识符已被占用。',
  deleteTitle: '删除该预设？',
  deleteDescription: '预设目录将被删除。已在其上运行的会话不受影响；新会话将无法再选择它。',
  deleteConfirm: '删除',
  deleting: '正在删除…',
}

/** Preset roster fields needed to resolve Web display copy. */
export interface PresetDisplaySource {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Unlocalized name published by the preset. */
  readonly name?: string
  /** Unlocalized description published by the preset. */
  readonly description?: string
}

/** Display copy resolved for the active Web locale. */
export interface PresetDisplayText {
  /** Localized built-in name or the preset's own fallback name. */
  readonly name: string
  /** Localized built-in description or the preset's own description. */
  readonly description?: string
}

interface PresetLocaleKeys {
  readonly name: AgentPresetSettingsKey
  readonly description: AgentPresetSettingsKey
}

const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  ptc: { name: 'presetPtcName', description: 'presetPtcDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
  'orchestration-sample': {
    name: 'presetOrchestrationSampleName',
    description: 'presetOrchestrationSampleDescription',
  },
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * @param preset - roster row whose copy is being rendered.
 * @param t - active Web locale lookup.
 * @returns localized copy for a known shipped preset, otherwise file metadata.
 */
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: AgentPresetSettingsKey) => string,
): PresetDisplayText {
  const keys = preset.trust === 'system' ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...preset.description === undefined ? {} : { description: preset.description },
  }
}
