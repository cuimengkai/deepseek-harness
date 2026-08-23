/**
 * Pure projection of the conversation-view tab ring under a session's agent
 * preset. Kept outside apply so the modes-filtering rule is unit-testable
 * without booting the plugin.
 */

import { resolveSlotLabel, type StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { ViewTab } from './contract/views.ts'

/**
 * Project one tab per registered 'conversation.view' entry, dropping entries
 * whose `modes` filter excludes the session's resolved agent preset. Entries
 * declaring no `modes` (chat, trajectory) always show; an entry gated to modes
 * stays hidden while the preset is unknown — a preset switch must never flash
 * the previous mode's tabs mid-load.
 * @param entries - the slot ledger's registered entries, in order.
 * @param agentPreset - the session's resolved preset id, absent while unloaded.
 * @returns the visible tabs in ledger order.
 */
export function filterViewTabs(
  entries: readonly StoredEntry[],
  agentPreset: string | undefined,
): ViewTab[] {
  const tabs: ViewTab[] = []
  for (const entry of entries) {
    /* v8 ignore next -- unreachable: list registration validates id at load. */
    if (entry.options.id === undefined) continue
    const modes = entry.options.modes
    if (modes !== undefined && (agentPreset === undefined || !modes.includes(agentPreset))) continue
    tabs.push({ id: entry.options.id, label: resolveSlotLabel(entry.options.label) ?? entry.options.id })
  }
  return tabs
}
