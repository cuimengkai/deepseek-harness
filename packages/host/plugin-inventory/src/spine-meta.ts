/**
 * Human-facing metadata for the shipped harness spine, keyed by module name.
 *
 * The spine rows live as bare `{ id, name }` rows in the `dsh-base` and
 * `dsh-web-app` bundle patches; a Loader entry carries no category or purpose.
 * This table is the single authoring home for that display metadata, so the
 * Web plugin manager can group and describe the ~168 harness plugins without
 * editing the composition layers. It is deliberately read-only: lookup is
 * pure, and an unknown module (a user install, a custom overlay row) simply
 * projects no category or description.
 * @module @deepseek-ai/dsh-host-plugin-inventory/spine-meta
 */

/** Harness-native category vocabulary. Names shared with the plugin-market
 * taxonomy (`ui`, `security`, `workflow`, `tools`, `session`, `skill`,
 * `model`) keep the unified filter a single vocabulary. */
export const CATEGORIES = [
  'core',
  'agent',
  'session',
  'model',
  'security',
  'capability',
  'tool',
  'skill',
  'subagent',
  'workflow',
  'compaction',
  'config',
  'ui',
] as const

/** One harness-native category label. */
export type SpineCategory = (typeof CATEGORIES)[number]

/** Display metadata for one spine module. */
export interface SpineMetaEntry {
  readonly category: SpineCategory
  /** One-line purpose shown in the plugin manager cards. */
  readonly description: string
}

/** The spine metadata table, grouped by category for authoring review. The
 * annotation both enforces that every entry conforms to {@link SpineMetaEntry}
 * and supplies the `string` index signature {@link spineMeta} reads. */
export const SPINE_META: Readonly<Record<string, SpineMetaEntry>> = {
  // ── core: runtime and loop foundations ──────────────────────────────────────
  '@deepseek-ai/cordis-plugin-timer': { category: 'core', description: 'Timers for delayed and periodic work' },
  '@deepseek-ai/cordis-plugin-hmr': { category: 'core', description: 'Hot-reload of config and module changes' },
  '@deepseek-ai/dsh-typert-registry': { category: 'core', description: 'Type-graph registry powering typed Remotes' },
  '@deepseek-ai/dsh-typert-loader': { category: 'core', description: 'Loads type graphs into the registry' },
  '@deepseek-ai/dsh-api-gateway': { category: 'core', description: 'Transport-agnostic Remote dispatch gateway' },
  '@deepseek-ai/dsh-commands': { category: 'core', description: 'Slash-command registry and dispatch' },
  '@deepseek-ai/dsh-command-feedback': { category: 'core', description: 'Command completion feedback' },
  '@deepseek-ai/dsh-tools': { category: 'core', description: 'Host tool registry and presentation mode' },
  '@deepseek-ai/dsh-token-meter': { category: 'core', description: 'Per-session token and context metering' },
  '@deepseek-ai/dsh-spill-local': { category: 'core', description: 'Local spill storage for oversized payloads' },
  '@deepseek-ai/dsh-spill-policy': { category: 'core', description: 'Inline spill threshold policy' },
  '@deepseek-ai/dsh-system-prompt': { category: 'core', description: 'System-prompt assembly registry' },
  '@deepseek-ai/dsh-host-plugin-inventory': { category: 'core', description: 'Read-only plugin inventory for the console' },
  '@deepseek-ai/dsh-host-plugin-manager': { category: 'core', description: 'Live plugin install and uninstall manager' },
  '@deepseek-ai/dsh-host-apiproxy': { category: 'core', description: 'Web API gateway for browser Remotes' },
  '@deepseek-ai/dsh-cordis-host-runner': { category: 'core', description: 'Cordis host runtime loader' },
  '@deepseek-ai/dsh-web-app/startup': { category: 'core', description: 'Parsed Web launch flags' },
  '@deepseek-ai/dsh-host-webserver': { category: 'core', description: 'HTTP server for the Web surface' },
  '@deepseek-ai/dsh-web-app': { category: 'core', description: 'Web surface glue: dist, trust fence, URL' },
  '@deepseek-ai/dsh-code-runtime-worker-thread': { category: 'core', description: 'Worker-thread code runtime' },
  '@deepseek-ai/dsh-message-feedback': { category: 'core', description: 'Per-message feedback service' },

  // ── agent: agent loop and goals ──────────────────────────────────────────────
  '@deepseek-ai/dsh-agent': { category: 'agent', description: 'Agent lifecycle and identity' },
  '@deepseek-ai/dsh-agent-loop': { category: 'agent', description: 'Agent-loop host for startup agents' },
  '@deepseek-ai/dsh-agent-default-model': { category: 'agent', description: 'Default model for new agents' },
  '@deepseek-ai/dsh-agent-instructions': { category: 'agent', description: 'Instruction attachment for agents' },
  '@deepseek-ai/dsh-user-questions': { category: 'agent', description: 'Ask-user question management' },
  '@deepseek-ai/dsh-goal': { category: 'agent', description: 'Goal domain service' },
  '@deepseek-ai/dsh-goal-round-driver': { category: 'agent', description: 'Goal round driving' },
  '@deepseek-ai/dsh-command-goal': { category: 'agent', description: '/goal slash command' },
  '@deepseek-ai/dsh-plan-mode': { category: 'agent', description: 'Plan-mode session guidance' },
  '@deepseek-ai/dsh-repeat-tool-reminder': { category: 'agent', description: 'Consecutive-repeat tool reminders' },
  '@deepseek-ai/dsh-agent-presets': { category: 'agent', description: 'Per-session agent preset roster' },

  // ── session: sessions and persistence ───────────────────────────────────────
  '@deepseek-ai/dsh-session': { category: 'session', description: 'Session domain and lifecycle' },
  '@deepseek-ai/dsh-session-title': { category: 'session', description: 'Deterministic session titles' },
  '@deepseek-ai/dsh-session-title-first-prompt-llm': { category: 'session', description: 'LLM session title generation' },
  '@deepseek-ai/dsh-session-persistence-jsonl': { category: 'session', description: 'Append-only JSONL session log' },
  '@deepseek-ai/dsh-attachment-local': { category: 'session', description: 'Durable message attachment bytes' },
  '@deepseek-ai/dsh-session-query-sqlite': { category: 'session', description: 'Session search and lineage queries' },
  '@deepseek-ai/dsh-session-projection': { category: 'session', description: 'Shared session projection registry' },
  '@deepseek-ai/dsh-session-checkpoint-policy': { category: 'session', description: 'Durability checkpoints before model calls' },
  '@deepseek-ai/dsh-session-telemetry-otel': { category: 'session', description: 'OTLP session telemetry exporter' },
  '@deepseek-ai/dsh-session-log-export': { category: 'session', description: 'Browser session export' },
  '@deepseek-ai/dsh-session-deletion': { category: 'session', description: 'Cascading session deletion' },
  '@deepseek-ai/dsh-command-session-delete': { category: 'session', description: 'Session-deletion slash command' },
  '@deepseek-ai/dsh-session-projection-cache': { category: 'session', description: 'Persisted session projection cache' },
  '@deepseek-ai/dsh-session-reference': { category: 'session', description: 'Session reference resolution' },
  '@deepseek-ai/dsh-file-reference-local': { category: 'session', description: 'File reference attachment' },
  '@deepseek-ai/dsh-session-stats': { category: 'session', description: 'Per-session turn and step counts' },

  // ── model: model capability ──────────────────────────────────────────────────
  '@deepseek-ai/dsh-llm': { category: 'model', description: 'LLM service definition and consumers' },
  '@deepseek-ai/dsh-llm-retry': { category: 'model', description: 'Model-request retry policy' },
  '@deepseek-ai/dsh-llm-pi-ai': { category: 'model', description: 'Multi-provider adapter twin' },
  '@deepseek-ai/dsh-llm-deepseek': { category: 'model', description: 'DeepSeek model adapter' },
  '@deepseek-ai/dsh-web-search-deepseek': { category: 'model', description: 'DeepSeek web-search adapter' },

  // ── security: safety and permissions ─────────────────────────────────────────
  '@deepseek-ai/dsh-credentials-local': { category: 'security', description: 'Credential store and providers' },
  '@deepseek-ai/dsh-sandbox-local': { category: 'security', description: 'Sandbox service' },
  '@deepseek-ai/dsh-sandbox-policy': { category: 'security', description: 'Sandbox policy presets' },
  '@deepseek-ai/dsh-bash-sandbox': { category: 'security', description: 'Bash command sandbox' },
  '@deepseek-ai/dsh-pwsh-sandbox': { category: 'security', description: 'PowerShell command sandbox' },
  '@deepseek-ai/dsh-user-approval': { category: 'security', description: 'User approval flows' },
  '@deepseek-ai/dsh-permission-presets': { category: 'security', description: 'Permission preset profiles' },
  '@deepseek-ai/dsh-fs-observation-policy': { category: 'security', description: 'Filesystem observation policy' },
  '@deepseek-ai/dsh-tool-call-timeout-policy': { category: 'security', description: 'Tool-call timeout enforcement' },

  // ── capability: capability providers ─────────────────────────────────────────
  '@deepseek-ai/dsh-subprocess-local': { category: 'capability', description: 'Subprocess service provider' },
  '@deepseek-ai/dsh-fs-sandbox': { category: 'capability', description: 'Sandboxed filesystem provider' },
  '@deepseek-ai/dsh-web': { category: 'capability', description: 'Web capability: search and fetch' },
  '@deepseek-ai/dsh-host-directory-picker-auto': { category: 'capability', description: 'Host directory picker' },

  // ── tool: model-facing tools ─────────────────────────────────────────────────
  '@deepseek-ai/dsh-tool-bash': { category: 'tool', description: 'Bash command tool' },
  '@deepseek-ai/dsh-tool-pwsh': { category: 'tool', description: 'PowerShell command tool' },
  '@deepseek-ai/dsh-tool-jobs': { category: 'tool', description: 'Background-job control tools' },
  '@deepseek-ai/dsh-tool-fs': { category: 'tool', description: 'Filesystem tool' },
  '@deepseek-ai/dsh-tool-fs-search': { category: 'tool', description: 'Filesystem search tool' },
  '@deepseek-ai/dsh-tool-skill': { category: 'tool', description: 'Skill catalog and loader tool' },
  '@deepseek-ai/dsh-tool-subagent-control': { category: 'tool', description: 'Subagent lifecycle control tool' },
  '@deepseek-ai/dsh-tool-subagent-control/list-agents': { category: 'tool', description: 'List running subagents tool' },
  '@deepseek-ai/dsh-tool-subagent': { category: 'tool', description: 'Subagent delegation tools' },
  '@deepseek-ai/dsh-tool-subagent-report': { category: 'tool', description: 'Subagent direct-child return tool' },
  '@deepseek-ai/dsh-tool-workflow': { category: 'tool', description: 'Workflow orchestration tool' },
  '@deepseek-ai/dsh-tool-todo': { category: 'tool', description: 'todo_write task tracking tool' },
  '@deepseek-ai/dsh-tool-ralph': { category: 'tool', description: 'Iterative agent refinement tool' },
  '@deepseek-ai/dsh-tool-str-replace-editor': { category: 'tool', description: 'String-replace file editor tool' },
  '@deepseek-ai/dsh-tool-web': { category: 'tool', description: 'Web search and fetch tool' },
  '@deepseek-ai/dsh-tool-goal': { category: 'tool', description: 'Goal management tool' },

  // ── skill: skill providers ───────────────────────────────────────────────────
  '@deepseek-ai/dsh-skill': { category: 'skill', description: 'Skill provider registry' },
  '@deepseek-ai/dsh-skill-filesystem': { category: 'skill', description: 'Filesystem skill provider' },
  '@deepseek-ai/dsh-skill-badge': { category: 'skill', description: 'Skill badge decorations' },

  // ── subagent: subagents ──────────────────────────────────────────────────────
  '@deepseek-ai/dsh-subagent': { category: 'subagent', description: 'Subagent registry and queries' },
  '@deepseek-ai/dsh-subagent-spawn-in-process': { category: 'subagent', description: 'In-process spawn provider' },
  '@deepseek-ai/dsh-subagent-fork-in-process': { category: 'subagent', description: 'In-process fork provider' },

  // ── workflow: workflows and background jobs ──────────────────────────────────
  '@deepseek-ai/dsh-jobs-local': { category: 'workflow', description: 'Background-job registry' },
  '@deepseek-ai/dsh-workflow-worker-thread': { category: 'workflow', description: 'Worker-thread workflow provider' },

  // ── compaction: conversation compaction ──────────────────────────────────────
  '@deepseek-ai/dsh-compaction-basic': { category: 'compaction', description: 'Automatic conversation compaction' },
  '@deepseek-ai/dsh-command-compact': { category: 'compaction', description: '/compact slash command' },
  '@deepseek-ai/dsh-compaction-tool-result-pruner': { category: 'compaction', description: 'Oversized tool-result pruning' },

  // ── config: settings and storage ─────────────────────────────────────────────
  '@deepseek-ai/dsh-settings-file': { category: 'config', description: 'User settings document' },
  '@deepseek-ai/dsh-shell-env': { category: 'config', description: 'Shell environment for the model' },
  '@deepseek-ai/dsh-storage': { category: 'config', description: 'Storage service' },
  '@deepseek-ai/dsh-storage-json': { category: 'config', description: 'JSON storage backend' },
  '@deepseek-ai/dsh-storage-domain': { category: 'config', description: 'Domain storage mapping' },
  '@deepseek-ai/dsh-workspace': { category: 'config', description: 'Workspace registry and metadata' },

  // ── ui: browser surface ──────────────────────────────────────────────────────
  '@deepseek-ai/dsh-client-hmr': { category: 'ui', description: 'Client-bundle hot reload' },
  '@deepseek-ai/dsh-client-modules': { category: 'ui', description: 'Client module table and boot scan' },
  '@deepseek-ai/dsh-client-connection': { category: 'ui', description: 'Browser transport: fetch and SSE' },
  '@deepseek-ai/dsh-api-remotes': { category: 'ui', description: 'Generated Remote client assembly' },
  '@deepseek-ai/dsh-client-runtime': { category: 'ui', description: 'Client runtime and boot' },
  '@deepseek-ai/dsh-cordis-client-runner': { category: 'ui', description: 'Browser Cordis kernel' },
  '@deepseek-ai/dsh-client-ui-theme': { category: 'ui', description: 'Theme tokens' },
  '@deepseek-ai/dsh-client-locale': { category: 'ui', description: 'Locale selection and dictionaries' },
  '@deepseek-ai/dsh-client-ui-layout': { category: 'ui', description: 'App layout shell' },
  '@deepseek-ai/dsh-client-ui-renderer': { category: 'ui', description: 'Message renderer' },
  '@deepseek-ai/dsh-client-ui-sidebar': { category: 'ui', description: 'Sidebar surface' },
  '@deepseek-ai/dsh-client-ui-settings': { category: 'ui', description: 'Settings surface' },
  '@deepseek-ai/dsh-client-ui-settings-general': { category: 'ui', description: 'General settings' },
  '@deepseek-ai/dsh-client-ui-settings-models': { category: 'ui', description: 'Model settings' },
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory': { category: 'ui', description: 'Plugins settings tab' },
  '@deepseek-ai/dsh-client-ui-conversation': { category: 'ui', description: 'Conversation surface' },
  '@deepseek-ai/dsh-client-ui-brand-official': { category: 'ui', description: 'Official brand slots' },
  '@deepseek-ai/dsh-client-ui-attachment': { category: 'ui', description: 'Attachment surfaces' },
  '@deepseek-ai/dsh-client-ui-tool': { category: 'ui', description: 'Tool-call views' },
  '@deepseek-ai/dsh-client-ui-cordis': { category: 'ui', description: 'Cordis debug views' },
  '@deepseek-ai/dsh-client-ui-workflow-run': { category: 'ui', description: 'Workflow lifecycle view' },
  '@deepseek-ai/dsh-client-ui-deliverables': { category: 'ui', description: 'Produced-files tail' },
  '@deepseek-ai/dsh-client-ui-workspace': { category: 'ui', description: 'Workspace surface' },
  '@deepseek-ai/dsh-client-ui-input-trigger': { category: 'ui', description: 'Input trigger pipeline' },
  '@deepseek-ai/dsh-client-ui-commands': { category: 'ui', description: 'Command palette surface' },
  '@deepseek-ai/dsh-client-ui-skill': { category: 'ui', description: 'Skill surface' },
  '@deepseek-ai/dsh-client-ui-subagent': { category: 'ui', description: 'Subagent views' },
  '@deepseek-ai/dsh-client-ui-reference': { category: 'ui', description: 'Reference sources surface' },
  '@deepseek-ai/dsh-client-ui-jobs': { category: 'ui', description: 'Background-jobs list' },
  '@deepseek-ai/dsh-client-ui-goal': { category: 'ui', description: 'Goal bar' },
  '@deepseek-ai/dsh-client-ui-message-feedback': { category: 'ui', description: 'Per-message feedback strip' },
  '@deepseek-ai/dsh-client-ui-model-selection': { category: 'ui', description: 'Model picker' },
  '@deepseek-ai/dsh-client-ui-permission-presets': { category: 'ui', description: 'Permission presets views' },
  '@deepseek-ai/dsh-client-ui-agent-preset': { category: 'ui', description: 'Agent-preset picker' },
  '@deepseek-ai/dsh-client-ui-settings-plugins': { category: 'ui', description: 'Plugin configuration sections' },
  '@deepseek-ai/dsh-client-ui-plan': { category: 'ui', description: 'Plan-mode seat' },
  '@deepseek-ai/dsh-client-ui-user-questions': { category: 'ui', description: 'Ask-user views' },
  '@deepseek-ai/dsh-client-ui-trajectory': { category: 'ui', description: 'Trajectory views' },
}

/**
 * Look up display metadata for one module name. Unknown modules (user
 * installs, custom overlay rows) project no category or description.
 * @param moduleName - the Loader entry's module specifier.
 * @returns the spine metadata, or `undefined` when the module is not spine.
 */
export function spineMeta(moduleName: string): SpineMetaEntry | undefined {
  return SPINE_META[moduleName]
}
