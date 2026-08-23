/** `flowEditor` namespace dictionaries (the flow-canvas view tab, toolbar, node inspector, and run surface). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'flowEditor'

/** The flow-editor dictionary key set (the source of truth for both locales). */
export type FlowEditorKey =
  | 'view.flowEditor'
  | 'toolbar.addAgent'
  | 'toolbar.addCondition'
  | 'toolbar.addLoop'
  | 'toolbar.newFlow'
  | 'toolbar.deleteFlow'
  | 'toolbar.run'
  | 'toolbar.stop'
  | 'toolbar.save'
  | 'toolbar.unsaved'
  | 'node.start'
  | 'node.end'
  | 'node.agent'
  | 'node.condition'
  | 'node.loop'
  | 'node.status.pending'
  | 'node.status.running'
  | 'node.status.done'
  | 'node.status.failed'
  | 'node.status.cancelled'
  | 'inspector.node'
  | 'inspector.prompt'
  | 'inspector.expression'
  | 'inspector.iterable'
  | 'inspector.variable'
  | 'inspector.label'
  | 'inspector.provider'
  | 'inspector.model'
  | 'inspector.modelKinds'
  | 'inspector.deleteNode'
  | 'inspector.deleteEdge'
  | 'inspector.edge'
  | 'inspector.branchLabel'
  | 'inspector.hint'
  | 'run.input'
  | 'run.noInput'
  | 'run.inputInvalid'
  | 'run.stopReason'
  | 'run.agentsStarted'
  | 'run.running'
  | 'run.completed'
  | 'run.cancelled'
  | 'run.error'
  | 'run.history'
  | 'run.noRuns'
  | 'palette.title'
  | 'palette.hint'
  | 'canvas.hint'
  | 'unavailable'
  | 'loadError'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The flow-editor view tab label, toolbar, inspector, and run-surface copy. */
    'flowEditor': FlowEditorKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<FlowEditorKey, string> = {
  'view.flowEditor': '流程',
  'toolbar.addAgent': 'Agent',
  'toolbar.addCondition': '条件',
  'toolbar.addLoop': '循环',
  'toolbar.newFlow': '新建',
  'toolbar.deleteFlow': '删除流程',
  'toolbar.run': '运行',
  'toolbar.stop': '停止',
  'toolbar.save': '保存',
  'toolbar.unsaved': '未保存',
  'node.start': '开始',
  'node.end': '结束',
  'node.agent': 'Agent',
  'node.condition': '条件',
  'node.loop': '循环',
  'node.status.pending': '待执行',
  'node.status.running': '运行中',
  'node.status.done': '完成',
  'node.status.failed': '失败',
  'node.status.cancelled': '已取消',
  'inspector.node': '节点',
  'inspector.prompt': '提示词',
  'inspector.expression': '条件表达式',
  'inspector.iterable': '可迭代对象',
  'inspector.variable': '循环变量',
  'inspector.label': '标签',
  'inspector.provider': 'Provider',
  'inspector.model': 'Model',
  'inspector.modelKinds': '按类型路由模型',
  'inspector.deleteNode': '删除节点',
  'inspector.deleteEdge': '删除连线',
  'inspector.edge': '连线',
  'inspector.branchLabel': '分支标签',
  'inspector.hint': '选择节点或连线进行编辑；从节点右侧圆点拖出连线。',
  'run.input': '运行输入 (JSON)',
  'run.noInput': '运行未提供输入',
  'run.inputInvalid': '输入不是合法 JSON',
  'run.stopReason': '结束原因',
  'run.agentsStarted': '启动子 Agent',
  'run.running': '运行中…',
  'run.completed': '已完成',
  'run.cancelled': '已取消',
  'run.error': '运行出错',
  'run.history': '运行历史',
  'run.noRuns': '暂无运行记录',
  'palette.title': '添加节点',
  'palette.hint': '拖到画布上添加节点。',
  'canvas.hint': '滚轮缩放 · 拖动背景平移 · Delete 删除选中项。',
  'unavailable': '当前会话未挂载流程引擎（flow engine），画布为只读。',
  'loadError': '流程加载失败：{message}',
}

/** English dictionary (the key-set source of truth is `zh`). */
export const en: Record<FlowEditorKey, string> = {
  'view.flowEditor': 'Flow',
  'toolbar.addAgent': 'Agent',
  'toolbar.addCondition': 'Condition',
  'toolbar.addLoop': 'Loop',
  'toolbar.newFlow': 'New',
  'toolbar.deleteFlow': 'Delete flow',
  'toolbar.run': 'Run',
  'toolbar.stop': 'Stop',
  'toolbar.save': 'Save',
  'toolbar.unsaved': 'Unsaved',
  'node.start': 'Start',
  'node.end': 'End',
  'node.agent': 'Agent',
  'node.condition': 'Condition',
  'node.loop': 'Loop',
  'node.status.pending': 'Pending',
  'node.status.running': 'Running',
  'node.status.done': 'Done',
  'node.status.failed': 'Failed',
  'node.status.cancelled': 'Cancelled',
  'inspector.node': 'Node',
  'inspector.prompt': 'Prompt',
  'inspector.expression': 'Condition expression',
  'inspector.iterable': 'Iterable',
  'inspector.variable': 'Loop variable',
  'inspector.label': 'Label',
  'inspector.provider': 'Provider',
  'inspector.model': 'Model',
  'inspector.modelKinds': 'Per-kind model routes',
  'inspector.deleteNode': 'Delete node',
  'inspector.deleteEdge': 'Delete edge',
  'inspector.edge': 'Edge',
  'inspector.branchLabel': 'Branch label',
  'inspector.hint': 'Select a node or an edge to edit; drag from a node\'s right port to connect.',
  'run.input': 'Run input (JSON)',
  'run.noInput': 'Run received no input',
  'run.inputInvalid': 'Input is not valid JSON',
  'run.stopReason': 'Stop reason',
  'run.agentsStarted': 'Agents started',
  'run.running': 'Running…',
  'run.completed': 'Completed',
  'run.cancelled': 'Cancelled',
  'run.error': 'Run errored',
  'run.history': 'Run history',
  'run.noRuns': 'No runs yet',
  'palette.title': 'Add node',
  'palette.hint': 'Drag onto the canvas to add a node.',
  'canvas.hint': 'Scroll to zoom · drag the background to pan · Delete removes the selection.',
  'unavailable': 'This session has no flow engine mounted; the canvas is read-only.',
  'loadError': 'Failed to load flows: {message}',
}
