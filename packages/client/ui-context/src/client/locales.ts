/** `contextView` namespace dictionaries (the view tab label + frame copy + row labels). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'contextView'

/** The context-view dictionary key set (the source of truth for both locales). */
export type ContextViewKey =
  | 'view.context'
  | 'frame.loading'
  | 'frame.empty'
  | 'frame.error'
  | 'empty.surface'
  | 'group.envelope'
  | 'group.surface'
  | 'group.compactions'
  | 'row.system'
  | 'row.tools'
  | 'row.surfaceMessage'
  | 'row.compaction'
  | 'label.tokens'
  | 'label.capacity'
  | 'label.usedWindow'
  | 'label.free'
  | 'label.unknownCapacity'
  | 'label.noRequest'
  | 'label.provider'
  | 'label.model'
  | 'label.seq'
  | 'label.role'
  | 'label.shadowed'
  | 'label.toolsCount'
  | 'label.noPreview'
  | 'label.copy'
  | 'label.copied'
  | 'label.systemTitle'
  | 'label.toolsTitle'
  | 'label.messageTitle'
  | 'label.compactionTitle'
  | 'label.summary'
  | 'label.logRevision'
  | 'range.hint'
  | 'range.selected'
  | 'range.compact'
  | 'range.compacting'
  | 'range.clear'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The context-view tab label, frame copy, and row labels. */
    'contextView': ContextViewKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<ContextViewKey, string> = {
  'view.context': '上下文',
  'frame.loading': '正在读取上下文…',
  'frame.empty': '该会话尚无上下文可读',
  'frame.error': '无法读取上下文组成',
  'empty.surface': '当前表面没有消息',
  'group.envelope': '请求信封',
  'group.surface': '对话表面',
  'group.compactions': '压缩历史',
  'row.system': '系统提示词',
  'row.tools': '工具目录',
  'row.surfaceMessage': '#{seq} {role}',
  'row.compaction': '压缩 #{seq}',
  'label.tokens': '{count} tokens',
  'label.capacity': '占用 {tokens}',
  'label.usedWindow': '已用 {used} / {window}',
  'label.free': '剩余 {tokens}',
  'label.unknownCapacity': '上下文窗口未知',
  'label.noRequest': '尚无请求',
  'label.provider': '提供方',
  'label.model': '模型',
  'label.seq': '日志序号',
  'label.role': '角色',
  'label.shadowed': '被折叠 {count} 条 · 约 {tokens} tokens',
  'label.toolsCount': '{count} 个工具',
  'label.noPreview': '（无文本预览）',
  'label.copy': '复制',
  'label.copied': '复制成功',
  'label.systemTitle': '系统提示词',
  'label.toolsTitle': '工具目录',
  'label.messageTitle': '表面消息',
  'label.compactionTitle': '压缩检查点',
  'label.summary': '摘要',
  'label.logRevision': '日志修订 {revision}',
  'range.hint': 'Shift+点击选择范围',
  'range.selected': '已选 {count} 条 · 约 {tokens} tokens',
  'range.compact': '压缩所选',
  'range.compacting': '压缩中…',
  'range.clear': '取消选择',
}

/** English dictionary. */
export const en: Record<ContextViewKey, string> = {
  'view.context': 'Context',
  'frame.loading': 'Reading context…',
  'frame.empty': 'No context to read for this session yet',
  'frame.error': 'Could not read the context composition',
  'empty.surface': 'No messages on the current surface',
  'group.envelope': 'Envelope',
  'group.surface': 'Conversation surface',
  'group.compactions': 'Compaction history',
  'row.system': 'System prompt',
  'row.tools': 'Tool catalog',
  'row.surfaceMessage': '#{seq} {role}',
  'row.compaction': 'Compaction #{seq}',
  'label.tokens': '{count} tokens',
  'label.capacity': 'Used {tokens}',
  'label.usedWindow': 'Used {used} / {window}',
  'label.free': 'Free {tokens}',
  'label.unknownCapacity': 'Context window unknown',
  'label.noRequest': 'No request yet',
  'label.provider': 'Provider',
  'label.model': 'Model',
  'label.seq': 'Log seq',
  'label.role': 'Role',
  'label.shadowed': 'Shadowed {count} rows · ~{tokens} tokens',
  'label.toolsCount': '{count} tools',
  'label.noPreview': '(no text preview)',
  'label.copy': 'Copy',
  'label.copied': 'Copied',
  'label.systemTitle': 'System prompt',
  'label.toolsTitle': 'Tool catalog',
  'label.messageTitle': 'Surface message',
  'label.compactionTitle': 'Compaction checkpoint',
  'label.summary': 'Summary',
  'label.logRevision': 'Log revision {revision}',
  'range.hint': 'Shift+click to select a range',
  'range.selected': 'Selected {count} rows · ~{tokens} tokens',
  'range.compact': 'Compact selection',
  'range.compacting': 'Compacting…',
  'range.clear': 'Clear selection',
}
