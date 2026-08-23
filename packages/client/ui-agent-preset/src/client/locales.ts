/** Locale bundles for the agent-preset settings row, hero chip, header label, and management section. */

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | 'title' | 'description' | 'loading' | 'error' | 'userTrust' | 'seatHint' | 'headerHint'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view'
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetCodeName' | 'presetCodeDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'builtInGroup' | 'customGroup'
  | 'brokenBadge' | 'brokenNoCopy' | 'brokenNoCompose'
  | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating'
  | 'compose' | 'composeTitle' | 'composeIntro' | 'newAgent'
  | 'handoff' | 'handoffHint'
  | 'palette' | 'paletteHint' | 'paletteSearch' | 'paletteLoading' | 'paletteUnavailable' | 'paletteEmpty'
  | 'compositionLabel' | 'compositionEmpty' | 'reorderHint'
  | 'canvasStart' | 'canvasEnd' | 'inspectorTitle' | 'rowId' | 'moveUp' | 'moveDown' | 'paletteCategoryOther'
  | 'paletteCollapse' | 'paletteExpand'
  | 'rowAdded' | 'alreadyAdded' | 'removeRow'
  | 'save' | 'saving' | 'noRows' | 'unchanged' | 'overwriteWarning' | 'back'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** English copy. */
export const en: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent preset',
  description: 'Applies to sessions you start from now on. Running sessions keep the preset they began with.',
  loading: 'Loading presets…',
  error: 'Could not load agent presets.',
  userTrust: 'Custom',
  seatHint: 'Agent preset for the session you are about to start',
  headerHint: 'The agent preset this session runs, fixed when it started',
  nav: 'Agent presets',
  sectionIntro:
    'A preset is the plugin composition one session\'s agent runs — its tools, prompt, and capabilities. '
    + 'Assemble one from the installed plugins, duplicate an existing one and make it yours, '
    + 'or let the agent draft one for you in Creator mode.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  presetStandardName: 'Standard mode',
  presetStandardDescription:
    'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.',
  presetCodeName: 'PTC mode',
  presetCodeDescription:
    'All Standard mode capabilities, with tools exposed through the Code Mode SDK so the model can combine multi-step operations in one TypeScript program.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription:
    'Two-tool coding agent with persistent bash and str_replace_editor.',
  presetCordisName: 'Creator mode',
  presetCordisDescription:
    'Built for creating custom agent presets, with all Standard mode capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.',
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
  compositionEmpty: 'Drag plugins here',
  reorderHint: 'Drag to reorder',
  canvasStart: 'Start',
  canvasEnd: 'End',
  inspectorTitle: 'Plugin details',
  rowId: 'Row id',
  moveUp: 'Move up',
  moveDown: 'Move down',
  paletteCategoryOther: 'Other',
  paletteCollapse: 'Collapse plugins',
  paletteExpand: 'Open plugins',
  rowAdded: 'Added',
  alreadyAdded: 'Already in the composition',
  removeRow: 'Remove',
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
  title: 'Agent 预设',
  description: '对此后新建的会话生效。运行中的会话保持它开始时的预设。',
  loading: '正在加载预设…',
  error: '无法加载 Agent 预设。',
  userTrust: '自定义',
  seatHint: '即将开始的这个会话所用的 Agent 预设',
  headerHint: '本会话运行的 Agent 预设，开始时即固定',
  nav: 'Agent 预设',
  sectionIntro: '预设即一个会话的 Agent 所运行的插件组装 —— 它的工具、提示词与能力。从已安装的插件组装一个、复制一份既有预设改成自己的，或用「创造模式」让 Agent 帮你创建。',
  builtIn: '内置',
  setDefault: '设为默认',
  view: '查看',
  presetStandardName: '标准模式',
  presetStandardDescription: '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。',
  presetCodeName: 'PTC 模式',
  presetCodeDescription: '具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
  presetMinimalName: '极简模式',
  presetMinimalDescription: '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
  presetCordisName: '创造模式',
  presetCordisDescription: '用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
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
  compositionEmpty: '把插件拖到这里',
  reorderHint: '拖拽调整顺序',
  canvasStart: '开始',
  canvasEnd: '结束',
  inspectorTitle: '插件详情',
  rowId: '行标识',
  moveUp: '上移',
  moveDown: '下移',
  paletteCategoryOther: '其他',
  paletteCollapse: '收起插件',
  paletteExpand: '展开插件',
  rowAdded: '已添加',
  alreadyAdded: '已在组合中',
  removeRow: '移除',
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
  code: { name: 'presetCodeName', description: 'presetCodeDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
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
