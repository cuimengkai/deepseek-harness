/** Locale keys for the Agent settings hub chrome. */

/** Hub copy keys. */
export type AgentHubLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'tabPresets' | 'tabModes' | 'tabSkills' | 'tabIntegrations' | 'empty'
  | 'overviewLead' | 'overviewStep1' | 'overviewStep2' | 'overviewStep3'
  | 'skills.title' | 'skills.intro' | 'skills.noSession' | 'skills.loading' | 'skills.empty'
  | 'skills.error' | 'skills.userOnly' | 'skills.pathsLead' | 'skills.pathHome' | 'skills.pathProject'
  | 'integrations.title' | 'integrations.intro' | 'integrations.search' | 'integrations.toPlugins'
  | 'integrations.toModels'
  | 'integrations.loading' | 'integrations.empty' | 'integrations.noMatch' | 'integrations.error'
  | 'integrations.connectorsHeading' | 'integrations.toConnectors' | 'integrations.connectorsEmpty'
  | 'integrations.connectorMeta'

/** English hub copy. */
export const hubEn: Record<AgentHubLocaleKey, string> = {
  nav: 'Agent',
  title: 'Scenario Agent',
  intro:
    'A scenario Agent is what users pick and chat with. Inside it are two builder steps: '
    + 'capabilities (tools and plugins) and orchestration (when and how those run). '
    + 'New sessions pick a scenario on the home screen; Start runs its entry flow.',
  overviewLead: 'Build in this order',
  overviewStep1: 'Capabilities — decide what the Agent can call',
  overviewStep2: 'Orchestration — design steps, branches, and the entry flow',
  overviewStep3: 'Use for new session — return to chat and Start the scenario',
  tabs: 'Agent pages',
  tabPresets: 'Capabilities',
  tabModes: 'Orchestration',
  tabSkills: 'Skills',
  tabIntegrations: 'Integrations',
  empty: 'No Agent pages are available in this deployment.',
  'skills.title': 'Skills Map',
  'skills.intro':
    'Skills are filesystem markdown packages the Host loads for the current session — not a marketplace.',
  'skills.noSession': 'Open or start a session to list skills resolved for that workspace and preset.',
  'skills.loading': 'Loading skills…',
  'skills.empty': 'No skills in this session\'s catalog yet. Add packages under the paths below.',
  'skills.error': 'Could not load skills: {message}',
  'skills.userOnly': 'User-invocable only (/name)',
  'skills.pathsLead': 'Install skills as folders with a SKILL.md at:',
  'skills.pathHome': '$DSH_HOME/skills',
  'skills.pathProject': '<project>/.agents/skills',
  'integrations.title': 'Integrations',
  'integrations.intro':
    'MCP connectors from the Host registry, plus installed plugins from inventory. Add a server under Connectors; compose plugins into a capability pack.',
  'integrations.connectorsHeading': 'Connectors',
  'integrations.toConnectors': 'Open Connectors',
  'integrations.connectorsEmpty': 'No MCP connectors yet. Add one by URL on the Connectors page.',
  'integrations.connectorMeta': '{status} · {target}',
  'integrations.search': 'Search plugins',
  'integrations.toPlugins': 'Open Plugins settings',
  'integrations.toModels': 'Open Models settings',
  'integrations.loading': 'Loading inventory…',
  'integrations.empty': 'No plugins reported by this Host inventory.',
  'integrations.noMatch': 'No plugins match this search.',
  'integrations.error': 'Could not load inventory: {message}',
}

/** Chinese hub copy. */
export const hubZh: Record<AgentHubLocaleKey, string> = {
  nav: 'Agent',
  title: '场景 Agent',
  intro:
    '场景 Agent 是用户选择并对话的对象。搭建时分为两步：能力（工具与插件）和编排（何时、如何调用）。'
    + '新会话在首页选场景；点「开始编排」才会跑入口流程。',
  overviewLead: '建议按这个顺序搭',
  overviewStep1: '能力 — 决定 Agent 能调用什么',
  overviewStep2: '编排 — 设计步骤、分支与入口流程',
  overviewStep3: '用于新会话 — 回到对话并开始场景',
  tabs: 'Agent 页面',
  tabPresets: '能力',
  tabModes: '编排',
  tabSkills: '技能',
  tabIntegrations: '集成',
  empty: '当前部署没有可用的 Agent 页面。',
  'skills.title': '技能地图',
  'skills.intro': '技能是宿主按当前会话加载的本地 Markdown 包，不是在线商店。',
  'skills.noSession': '打开或开始一个会话后，才能列出该工作区与预设解析到的技能。',
  'skills.loading': '正在加载技能…',
  'skills.empty': '当前会话目录里还没有技能。可按下方路径添加。',
  'skills.error': '无法加载技能：{message}',
  'skills.userOnly': '仅用户可调用（/name）',
  'skills.pathsLead': '将含 SKILL.md 的技能目录放在：',
  'skills.pathHome': '$DSH_HOME/skills',
  'skills.pathProject': '<项目>/.agents/skills',
  'integrations.title': '集成',
  'integrations.intro':
    '来自宿主登记表的 MCP 连接器，以及清单中的已安装插件。在「连接器」页按 URL 添加服务器；把插件编进能力包。',
  'integrations.connectorsHeading': '连接器',
  'integrations.toConnectors': '打开连接器',
  'integrations.connectorsEmpty': '还没有 MCP 连接器。到连接器页按 URL 添加一个。',
  'integrations.connectorMeta': '{status} · {target}',
  'integrations.search': '搜索插件',
  'integrations.toPlugins': '打开插件设置',
  'integrations.toModels': '打开模型设置',
  'integrations.loading': '正在加载清单…',
  'integrations.empty': '当前宿主清单没有插件。',
  'integrations.noMatch': '没有匹配的插件。',
  'integrations.error': '无法加载清单：{message}',
}
