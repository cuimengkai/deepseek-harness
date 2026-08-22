import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { boot, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { isJsExpr, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import * as yaml from 'js-yaml'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { PlatformShellError } from '@deepseek-ai/dsh-experimental-platform-shell/src/index.ts'
import { CapabilityId, RoleId, ScenarioId } from '@deepseek-ai/dsh-experimental-platform-shell/src/types.ts'
import { bindActor, bindWorkspace } from './capability-market-demo.ts'

const COMPOSE_PATH = fileURLToPath(new URL('../cordis.yml', import.meta.url))
const PRESETS_ROOT = fileURLToPath(new URL('../presets', import.meta.url))

// The demo-owned persona-row plugin the assembled preset's capability rows name
// by absolute path. A preset row resolves a relative specifier against its own
// composition directory, so the checked-in demo plugin is reached through the
// absolute filesystem path (the load is a scratch artifact of this run).
const PERSONA_ROW = fileURLToPath(new URL('./persona-row.ts', import.meta.url))

/** Wait until an agent reaches the given status, then resolve. */
function waitForStatus(ctx: Context, agent: Agent, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      dispose()
      reject(new Error(`agent ${agent.session.id} never reached ${target}`))
    }, 60_000)
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent) return
      if (status === target) {
        clearTimeout(timeout)
        dispose()
        resolve()
      }
    })
  })
}

/** Resolve the Agent handle for one created agent by session id. */
function findAgent(ctx: Context, sessionId: string): Agent | undefined {
  return ctx.agents.get(SessionId(sessionId))
}

/** The final assistant text from a session's events. */
function finalText(events: SessionEvent[]): string {
  const message = events.findLast(event => event.type === 'assistant/message')
  if (message?.type !== 'assistant/message') return ''
  return message.data.message.content.map(block => block.type === 'text' ? block.text : '').join('')
}

/** Read one session's persisted JSONL log back (the traceability surface). */
async function readPersistedEvents(persistenceRoot: string, sessionId: string): Promise<SessionEvent[]> {
  const files = await readdir(persistenceRoot, { recursive: true })
  const logFile = files.find(file => file.includes(sessionId) && file.endsWith('.jsonl'))
  if (logFile === undefined) return []
  const raw = await readFile(join(persistenceRoot, logFile), 'utf8')
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as SessionEvent)
}

/** Create one agent, mounting the preset behind its workbench. */
async function createAgent(ctx: Context, sessionId: string, preset: string, cwd: string): Promise<Agent> {
  const roster = ctx.agentPresets
  await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId(sessionId),
    agentOptions: { provider: 'market-demo', model: 'mock-model' },
    meta: { cwd },
    setup: async (agentCtx) => { await roster.mount(agentCtx, preset) },
  })
  const agent = findAgent(ctx, sessionId)
  if (agent === undefined) throw new Error(`${sessionId} agent missing`)
  return agent
}

/** Drive one turn of one agent and wait for it to finish. */
async function driveTurn(ctx: Context, agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await waitForStatus(ctx, agent, 'idle')
}

/** Every tool/result error code a session saw, oldest first. */
function errorCodes(events: SessionEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type !== 'tool/result' || event.data.error === undefined) return []
    return [event.data.error.code]
  })
}

/** The model-facing rendered text inside one tool/result message. */
function renderedText(message: ToolResultMessage): string {
  return message.content.flatMap(block => block.content.filter(b => b.type === 'text').map(b => b.text)).join('')
}

/** The model-facing error text of every rejected tool call. */
function toolErrorTexts(events: SessionEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type !== 'tool/result' || event.data.error === undefined) return []
    return [renderedText(event.data.message)]
  })
}

/** The tool/result outcome of every `analyze_code` call, paired by call id. */
function analyzeCodeOutcomes(events: SessionEvent[]): { callId: string; error: string | null; text: string }[] {
  return events.flatMap((event) => {
    if (event.type !== 'tool/result') return []
    return [{
      callId: event.data.message.content[0].toolCallId,
      error: event.data.error?.code ?? null,
      text: renderedText(event.data.message),
    }]
  }).filter(result => result.callId === 'p-analyze-open' || result.callId === 'p-analyze-closed')
}

/** The market tools registered by the platform-shell consumer. */
const marketTools = ['publish_capability', 'list_capabilities', 'assemble_capabilities',
  'set_capability_gate', 'publish_scenario', 'list_scenarios',
  'consume_capability', 'account_balance', 'settle_account', 'assemble_preset'].sort()

/**
 * A `!!js` disabled node gating one preset row to the CURRENT platform. The
 * `EntryOptions.disabled` field is typed `boolean | null`, but the entry-list
 * YAML dialect round-trips a plain `{ __jsExpr }` node as a `!!js` scalar the
 * Loader evaluates — this is the platform-conditional disabled pattern the
 * assembler reports (never rejects) as `disabledOnPlatform`.
 */
function platformDisabledExpr(platform: string): boolean {
  return { __jsExpr: `process.platform === '${platform}'` } as unknown as boolean
}

/**
 * One demo persona row for an assembly capability: a `persona-row` plugin
 * instance contributing a distinct prompt section. The section name and render
 * order are the catalog-level contract of the row; distinct sections let a
 * mounted workbench compose the base persona plus one persona per capability.
 * @param id - the row id (the composable slot the roster owns).
 * @param section - the prompt section name this row registers.
 * @param order - render order, after the base persona's `deployment:persona`.
 * @param text - the persona prose.
 * @returns the composition row.
 */
function personaRow(id: string, section: string, order: number, text: string): EntryOptions {
  return { id, name: PERSONA_ROW, config: { section, order, text } }
}

/**
 * The stable, machine-independent projection of one preset-tree row for the
 * demo output. The raw row names an absolute plugin path on the demo host, so
 * the projection collapses that to a label; a `!!js` disabled node becomes the
 * platform-conditional marker instead of the host platform name.
 * @param row - the composition row to project.
 * @returns the stable projection.
 */
function rowProjection(row: EntryOptions): {
  id: string
  name: string
  section: string | null
  disabled: string | null
} {
  const config = row.config as Record<string, unknown> | undefined
  return {
    id: row.id,
    name: row.name.startsWith('@deepseek-ai/dsh-') ? row.name : 'persona-row (demo plugin)',
    section: config !== undefined && typeof config.section === 'string' ? config.section : null,
    disabled: isJsExpr(row.disabled) ? 'platform-conditional' : null,
  }
}

async function main() {
  loadEnv('capability-market-demo')

  // A scratch root for the demo's one control-plane SQLite database and the
  // persisted session logs. Repo-local `.storages/` keeps it gitignored. Clear
  // any prior run's leftover (a crashed run must not collide with a new one).
  const workdir = join(import.meta.dirname, '..', '..', '..', '.storages', 'capability-market-demo')
  const persistenceRoot = join(workdir, '.sessions')
  const roleWorkspaces = ['operator', 'product', 'video', 'creator', 'content'].map(role => join(workdir, role))
  await rm(workdir, { recursive: true, force: true })
  await mkdir(workdir, { recursive: true })
  await mkdir(persistenceRoot, { recursive: true })
  // The scratch writable preset root the committed assembled workbench lands in
  // (first user root, so `writableRoot` targets it — never the checked-in dir).
  await mkdir(join(workdir, 'presets'), { recursive: true })
  await Promise.all(roleWorkspaces.map(dir => mkdir(dir, { recursive: true })))

  const ctx = await boot(
    'capability-market-demo',
    resolveConfigPath(COMPOSE_PATH, undefined),
    [{
      // The roster's cordis.yml row sets `path: ./presets`, which resolves
      // against the boot process cwd. Override it with the absolute demo
      // presets dir — the same id-targeted override pattern the persistence
      // row uses.
      id: 'agent-presets',
      name: '@deepseek-ai/dsh-agent-presets',
      config: {
        default: 'product-engineering',
        roots: [
          { path: join(workdir, 'presets'), trust: 'user' },
          { path: PRESETS_ROOT, trust: 'user' },
        ],
        includeUserRoot: false,
      },
    }, {
      // Session logs land in a fresh scratch root instead of the checked-in
      // `.capability-market-demo-sessions` default.
      id: 'persistence',
      name: '@deepseek-ai/dsh-session-persistence-jsonl',
      config: {
        root: persistenceRoot,
        compression: 'none',
      },
    }, {
      // The control-plane database lives in the scratch root so the demo
      // never writes a checked-in artifact. The name matches the cordis.yml
      // row's source-entry name (id-targeted patch, so a mismatch is skipped).
      id: 'platform-shell',
      name: '@deepseek-ai/dsh-experimental-platform-shell/src/index.ts',
      config: {
        path: join(workdir, 'control-plane.sqlite'),
      },
    }],
    () => {
      // Nothing to prepare here — the config tree itself mounts the demo
      // plugin, the platform-shell service, and the invariant companion.
    },
  )

  // ── tenant: one workspace per customer group, one market operator ─────────
  const shell = ctx.platformShell
  const wsProduct = shell.createWorkspace('Product Engineering')
  const wsVideo = shell.createWorkspace('Short Video')
  const admin = shell.registerUser('Admin')
  const alice = shell.registerUser('Alice')
  const bob = shell.registerUser('Bob')
  shell.assignRole(wsProduct, admin, RoleId('platform-admin'))
  shell.assignRole(wsProduct, alice, RoleId('product'))
  shell.assignRole(wsVideo, admin, RoleId('platform-admin'))
  shell.assignRole(wsVideo, bob, RoleId('product'))

  // Bind each agent session to the platform user acting through it and to the
  // platform workspace it runs in (the execution gate re-checks the market gate
  // per workspace at tool-call time).
  bindActor('market-operator', admin)
  bindActor('market-product', alice)
  bindActor('market-video', bob)
  bindActor('market-creator', alice)
  bindWorkspace('market-operator', wsProduct)
  bindWorkspace('market-product', wsProduct)
  bindWorkspace('market-video', wsVideo)
  bindWorkspace('market-creator', wsProduct)

  // Open the simulated billing accounts before any consumption is metered.
  shell.creditAccount(admin, wsProduct, 100)
  shell.creditAccount(admin, wsVideo, 10)

  const period = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  const operator = await createAgent(ctx, 'market-operator', 'platform-admin', join(workdir, 'operator'))
  const product = await createAgent(ctx, 'market-product', 'product-engineering', join(workdir, 'product'))
  const video = await createAgent(ctx, 'market-video', 'short-video-creation', join(workdir, 'video'))

  // ── 1. Operator publishes the catalog + both workbenches ──────────────────
  await driveTurn(ctx, operator, 'Publish the market catalog and both workbench scenarios.')

  // The store refuses to orphan a capability others depend on: unpublishing
  // code-analysis (a dependency target) violates the FK chain, which is why a
  // `CAPABILITY_DEPENDENCY_MISSING` edge can never be stored through the
  // service — dependency edges cannot dangle.
  let orphanRefusal: string | null = null
  try {
    shell.unpublishCapability(admin, CapabilityId('code-analysis'))
  } catch (error: unknown) {
    orphanRefusal = error instanceof Error ? error.message : String(error)
  }

  // ── 2. Product: transitive auto-resolve + a version-range mismatch ────────
  await driveTurn(ctx, product,
    `Assemble capabilities on the product-engineering workbench in workspace ${wsProduct}.`)

  // Fix the catalog mistake (code-refactor demanded code-analysis >=2.0.0 while
  // the catalog holds 1.0.0): unpublish and re-publish with a satisfied range.
  // Unpublishing cascades the workbench membership (scenario_capabilities is
  // ON DELETE CASCADE), so re-publish the product-engineering scenario to
  // restore code-refactor into its workbench.
  shell.unpublishCapability(admin, CapabilityId('code-refactor'))
  shell.publishCapability(admin, {
    id: CapabilityId('code-refactor'),
    name: 'Code Refactor',
    roleId: RoleId('dev'),
    execution: 'managed',
    version: '1.0.0',
    rate: 7,
    dependencies: [{ id: CapabilityId('code-analysis'), range: '>=1.0.0' }],
    description: 'refactors code under analysis guidance',
  })
  shell.unpublishScenario(admin, ScenarioId('product-engineering'))
  shell.publishScenario(admin, {
    id: ScenarioId('product-engineering'),
    name: 'Product Engineering',
    workbenchId: 'product-engineering',
    roleId: RoleId('product'),
    preset: 'product-engineering',
    capabilityIds: [
      CapabilityId('code-analysis'),
      CapabilityId('requirement-management'),
      CapabilityId('test-case-generation'),
      CapabilityId('test-execution'),
      CapabilityId('code-refactor'),
    ],
  })

  // Reassemble the fixed refactor, then meter consumption up to an overdraft.
  await driveTurn(ctx, product, 'continue:fix-version — reassemble code-refactor, then consume.')

  // ── 3. Gating: a disabled dependency refuses the assembly loudly ──────────
  await driveTurn(ctx, operator, 'operator:gate code-analysis disabled')
  await driveTurn(ctx, product, 'continue:disabled-dep — assemble requirement-management.')

  // ── 4. Gating: a rollout-0 capability refuses every workspace ─────────────
  await driveTurn(ctx, operator, 'operator:gate code-analysis enabled test-execution rollout 0')
  await driveTurn(ctx, product, 'continue:rollout-0 — assemble test-execution.')

  // ── 5. Rollout opens and the ledger is read back ──────────────────────────
  await driveTurn(ctx, operator, 'operator:gate test-execution rollout 1')
  await driveTurn(ctx, product, 'continue:ledger — assemble test-execution.')

  // ── 6. Short-video workbench: its own capability set + a conflict ─────────
  await driveTurn(ctx, video,
    `Assemble the short-video-creation workbench in workspace ${wsVideo} and produce a clip.`)

  // ── 7. Guided build: a creator agent assembles a workbench preset tree ─────
  // The operator publishes four assembly capabilities whose preset rows each
  // contribute one persona section (distinct `persona-row` sections, because the
  // shipped `dsh-persona` row registers a FIXED `deployment:persona` section and
  // duplicates within one layer throw), plus a content-marketing scenario binding
  // them. A non-operator creator agent then renders + validates the workbench
  // preset tree with `assemble_preset`; the host commits the validated rows to
  // the roster and mounts a fresh agent on the assembled preset.
  const contentAnalyticsRows: EntryOptions[] = [
    personaRow('content-analytics', 'capability:content-analytics', 12,
      'You analyze content performance against the campaign goals.'),
    {
      id: 'content-analytics-desktop',
      name: PERSONA_ROW,
      disabled: platformDisabledExpr(process.platform),
      config: {
        section: 'capability:content-analytics-desktop',
        order: 14,
        text: 'desktop-only analytics: performance deep-dives require a desktop workspace.',
      },
    },
  ]
  const contentCapabilities: {
    id: string
    name: string
    description: string
    rate: number
    tools: readonly string[]
    rows: readonly EntryOptions[]
  }[] = [
    { id: 'content-planning', name: 'Content Planning', description: 'plans the content calendar', rate: 2, tools: [],
      rows: [personaRow('content-planning', 'capability:content-planning', 10, 'You plan the content calendar for the marketing channel.')] },
    { id: 'content-publishing', name: 'Content Publishing', description: 'publishes finished content', rate: 3, tools: ['content_export'],
      rows: [personaRow('content-publishing', 'capability:content-publishing', 11, 'You publish finished content to the marketing channel.')] },
    { id: 'content-analytics', name: 'Content Analytics', description: 'analyzes content performance', rate: 4, tools: [], rows: contentAnalyticsRows },
    // content-review shares `content_export` with content-publishing on purpose:
    // the assembler refuses a selection that shadows one tool name across two
    // capabilities (the gate's owner read is non-deterministic), proved below.
    { id: 'content-review', name: 'Content Review', description: 'reviews content before publishing', rate: 2, tools: ['content_export'],
      rows: [personaRow('content-review', 'capability:content-review', 13, 'You review content before publishing.')] },
  ]
  for (const spec of contentCapabilities) {
    shell.publishCapability(admin, {
      id: CapabilityId(spec.id),
      name: spec.name,
      roleId: RoleId('product'),
      execution: 'managed',
      version: '1.0.0',
      rate: spec.rate,
      description: spec.description,
      tools: [...spec.tools],
      rows: spec.rows,
    })
  }
  shell.publishScenario(admin, {
    id: ScenarioId('content-marketing'),
    name: 'Content Marketing',
    workbenchId: 'content-marketing',
    roleId: RoleId('product'),
    preset: 'assembled-content-marketing',
    capabilityIds: [
      CapabilityId('content-planning'),
      CapabilityId('content-publishing'),
      CapabilityId('content-analytics'),
      CapabilityId('content-review'),
    ],
  })

  const creator = await createAgent(ctx, 'market-creator', 'product-engineering', join(workdir, 'creator'))
  await driveTurn(ctx, creator, `Assemble the content-marketing workbench preset for workspace ${wsProduct}.`)

  const creatorEvents = [...creator.session.events]
  const assembledEvent = creatorEvents.find(
    (e): e is Extract<SessionEvent, { type: 'preset/assembled' }> => e.type === 'preset/assembled',
  )
  if (assembledEvent === undefined) {
    throw new Error('the market-creator session never emitted a preset/assembled event')
  }
  const assembledRows = assembledEvent.data.rows

  // The assembler is a pure function of (base, resolved, patches): the SAME
  // request re-rendered through the service yields deep-equal rows. The base is
  // re-read from the roster exactly as the tool's binding resolved it.
  const rolePresetText = await ctx.agentPresets.read('product-engineering')
  const baseRows = yaml.load(rolePresetText, { schema: entryListSchema }) as EntryOptions[]
  const reRendered = shell.assemblePreset(admin, {
    workspaceId: wsProduct,
    scenarioId: ScenarioId('content-marketing'),
    roleId: RoleId('product'),
    rolePreset: 'product-engineering',
    base: baseRows,
    selected: [CapabilityId('content-planning'), CapabilityId('content-publishing'), CapabilityId('content-analytics')],
    preset: 'assembled-content-marketing',
  })
  const deterministic = JSON.stringify(reRendered.rows) === JSON.stringify(assembledRows)

  // A host-supplied base with a duplicate row id and a selection that shadows
  // one tool name across two capabilities must both refuse loudly, so neither
  // tree can reach the roster.
  let rowIdConflict: string | null = null
  try {
    shell.assemblePreset(admin, {
      workspaceId: wsProduct,
      scenarioId: ScenarioId('content-marketing'),
      roleId: RoleId('product'),
      rolePreset: 'product-engineering',
      base: [...baseRows, { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { text: 'a duplicate persona row' } }],
      selected: [CapabilityId('content-planning')],
      preset: 'assembled-conflict',
    })
  } catch (error: unknown) {
    rowIdConflict = error instanceof PlatformShellError ? error.code : null
  }
  let toolNameConflict: string | null = null
  try {
    shell.assemblePreset(admin, {
      workspaceId: wsProduct,
      scenarioId: ScenarioId('content-marketing'),
      roleId: RoleId('product'),
      rolePreset: 'product-engineering',
      base: baseRows,
      selected: [CapabilityId('content-publishing'), CapabilityId('content-review')],
      preset: 'assembled-conflict',
    })
  } catch (error: unknown) {
    toolNameConflict = error instanceof PlatformShellError ? error.code : null
  }

  // Commit the validated rows to the roster, then mount a fresh agent on the
  // assembled preset and assert the composed system prompt carries the base
  // persona + the capability personas in catalog order, minus the row disabled
  // for this platform.
  await ctx.agentPresets.write('assembled-content-marketing', assembledRows, {
    name: 'Assembled Content Marketing',
    description: 'content-marketing workbench preset assembled from the capability market by the market-creator agent',
  })
  const content = await createAgent(ctx, 'market-content', 'assembled-content-marketing', join(workdir, 'content'))
  // The loop scopes every agent's ctx, but `scopeOf` types the unscoped arm as
  // `undefined`; the assembled preset's persona sections only participate in an
  // assembly that names the agent's scope, so a missing scope would fake the
  // mounted-surface proof and must fail loud.
  const contentScope = scopeOf(content.ctx)
  if (contentScope === undefined) throw new Error('market-content agent ctx is unscoped')
  const composedPrompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: contentScope }))
  const containsBase = composedPrompt.includes('product engineer on the product-engineering workbench')
  const containsPlanning = composedPrompt.includes('plan the content calendar')
  const containsPublishing = composedPrompt.includes('publish finished content')
  const containsAnalytics = composedPrompt.includes('analyze content performance')
  const excludesDisabled = !composedPrompt.includes('desktop-only analytics')
  const planAt = composedPrompt.indexOf('plan the content calendar')
  const publishAt = composedPrompt.indexOf('publish finished content')
  const analyticsAt = composedPrompt.indexOf('analyze content performance')
  const inCatalogOrder = planAt >= 0 && planAt < publishAt && publishAt < analyticsAt

  // ── 8. Operator closes both billing periods ───────────────────────────────
  await driveTurn(ctx, operator, `operator:settle ${wsProduct} ${wsVideo} for period ${period}`)

  // ── Durable evidence: flush, then read the persisted logs back ────────────
  await ctx.sessions.flush(operator.session)
  await ctx.sessions.flush(product.session)
  await ctx.sessions.flush(video.session)
  const operatorEvents = [...operator.session.events]
  const productEvents = [...product.session.events]
  const videoEvents = [...video.session.events]
  const persisted = async (sessionId: string): Promise<SessionEvent[]> =>
    readPersistedEvents(persistenceRoot, sessionId)
  const persistedOperator = await persisted('market-operator')
  const persistedProduct = await persisted('market-product')
  const persistedVideo = await persisted('market-video')
  // The model-visible ⟺ logged proof: each market tool's presentationMeta lands
  // in the PERSISTED tool/result event, not just the in-memory one.
  const metaCodes = (events: SessionEvent[]): (string | null | undefined)[] =>
    events.filter((e): e is Extract<SessionEvent, { type: 'tool/result' }> => e.type === 'tool/result')
      .map((e) => {
        const meta = e.data.meta
        return meta !== null && typeof meta === 'object' && !Array.isArray(meta) && typeof meta.code === 'string'
          ? meta.code
          : null
      })
  const catalogs = (agent: Agent): string[] =>
    ctx.tools.schemas(scopeOf(agent.ctx)).map(s => s.name).sort()
  const catalogOperator = catalogs(operator)
  const catalogProduct = catalogs(product)
  const catalogVideo = catalogs(video)

  // The loud rejection texts the agents hit — these reconstruct the catalog
  // edges (dependency ranges, conflict pairs) from behavior, because a catalog
  // record is the flat entry without its edge tables.
  const productErrors = errorCodes(productEvents)
  const videoErrors = errorCodes(videoEvents)
  const productErrorTexts = toolErrorTexts(productEvents)
  const videoErrorTexts = toolErrorTexts(videoEvents)
  const versionErrorText = productErrorTexts.find(text => text.includes('does not satisfy')) ?? null
  const conflictErrorText = videoErrorTexts.find(text => text.includes('conflict')) ?? null

  // ── Store-level facts ─────────────────────────────────────────────────────
  const capabilities = shell.listCapabilities(admin)
  const scenarios = shell.listScenarios(admin)
  const productCapabilities = capabilities
    .filter(c => ['code-analysis', 'requirement-management', 'test-case-generation', 'test-execution', 'code-refactor'].includes(c.id))
  const videoCapabilities = capabilities
    .filter(c => ['short-video-recorder', 'short-video-editor', 'short-video-publisher'].includes(c.id))
  const wsProductUsage = shell.listUsage(admin, wsProduct)
  const wsVideoUsage = shell.listUsage(admin, wsVideo)
  const wsProductBalance = shell.accountBalance(admin, wsProduct)?.balance ?? 0
  const wsVideoBalance = shell.accountBalance(admin, wsVideo)?.balance ?? 0

  // The store's final answers for the assembly proofs.
  const transitive = shell.resolveCapabilities(admin, {
    workspaceId: wsProduct, scenarioId: ScenarioId('product-engineering'), selected: [CapabilityId('test-execution')],
  })
  const refactorFixed = shell.resolveCapabilities(admin, {
    workspaceId: wsProduct, scenarioId: ScenarioId('product-engineering'), selected: [CapabilityId('code-refactor')],
  })
  const videoSet = shell.resolveCapabilities(admin, {
    workspaceId: wsVideo, scenarioId: ScenarioId('short-video-creation'),
    selected: [CapabilityId('short-video-recorder'), CapabilityId('short-video-publisher')],
  })

  const auditRows = [
    ...shell.listAudit(admin, { workspaceId: wsProduct }),
    ...shell.listAudit(admin, { workspaceId: wsVideo }),
  ]
  const auditByAction = auditRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.action] = (acc[row.action] ?? 0) + 1
    return acc
  }, {})

  // The workbench → preset binding: each agent's scope chain is bound to the
  // preset its workbench names. The roster records no session event for a
  // mount (the apiproxy host layer appends `agent-preset/selected` instead),
  // so the live composed binding is the authoritative read.
  const rosterMount = (agent: Agent): string | undefined =>
    ctx.agentPresets.composedPreset(agent.ctx)

  // The settlement rows the operator's settle_account tool rendered.
  const settlements = operatorEvents.flatMap((event) => {
    if (event.type !== 'tool/result') return []
    const text = renderedText(event.data.message)
    const match = /settlement (settlement-\d+) closed (\d{4}-\d{2}) at (\d+) credits \((\w+)\)/.exec(text)
    return match === null ? [] : [{
      id: match[1] as string, period: match[2] as string, amount: Number(match[3]), status: match[4] as string,
    }]
  })

  const referenceEvents = {
    capabilityPublished: [...operatorEvents, ...productEvents, ...videoEvents]
      .filter(e => e.type === 'capability/published').length,
    capabilitySelected: [...productEvents, ...videoEvents]
      .filter((e): e is Extract<SessionEvent, { type: 'capability/selected' }> => e.type === 'capability/selected')
      .map(e => ({ preset: e.data.preset, requested: [...e.data.capabilityIds] })),
    presetAssembled: creatorEvents
      .filter((e): e is Extract<SessionEvent, { type: 'preset/assembled' }> => e.type === 'preset/assembled')
      .map(e => ({ preset: e.data.preset, capabilityIds: [...e.data.capabilityIds], rows: e.data.rows.length })),
    billingSettlement: operatorEvents
      .filter((e): e is Extract<SessionEvent, { type: 'billing/settlement' }> => e.type === 'billing/settlement')
      .map(e => ({ settlementId: e.data.settlementId, period: e.data.period, status: e.data.status })),
  }

  const uniformlyVisible = marketTools.every(tool =>
    [catalogOperator, catalogProduct, catalogVideo].every(catalog => catalog.includes(tool)))
  const conflictRejected = videoErrors.includes('CAPABILITY_CONFLICT')
  const versionMismatchRejected = productErrors.includes('VERSION_MISMATCH')
  const disabledDependencyRejected = productErrors.includes('CAPABILITY_DISABLED')
    && productErrorTexts.some(text => text.includes('code-analysis'))
  const rolloutRejected = productErrors.includes('CAPABILITY_DISABLED')
    && productErrorTexts.some(text => text.includes('test-execution'))
  const overdraftRejected = productErrors.includes('INSUFFICIENT_BALANCE')
  const analyzeCodeResults = analyzeCodeOutcomes(productEvents)
  const runtimeGateOpen = analyzeCodeResults
    .some(result => result.callId === 'p-analyze-open' && result.error === null)
  const runtimeGateClosed = analyzeCodeResults
    .some(result => result.callId === 'p-analyze-closed' && result.error === 'CAPABILITY_DISABLED')
  const analyzeOpenText = analyzeCodeResults.find(result => result.callId === 'p-analyze-open')?.text ?? null
  const analyzeClosedText = analyzeCodeResults.find(result => result.callId === 'p-analyze-closed')?.text ?? null
  const transitiveChain = transitive.resolved.map(c => c.id)
  const settlementsSettled = settlements.length === 2 && settlements.every(s => s.status === 'settled')
  const wsProductSpend = wsProductUsage.reduce((sum, row) => sum + row.cost, 0)

  console.log(JSON.stringify({
    catalog: {
      count: capabilities.length,
      ids: capabilities.map(c => c.id).sort(),
      productEngineering: productCapabilities.map(c => ({
        id: c.id, version: c.version, rate: c.rate, execution: c.execution,
      })),
      shortVideo: videoCapabilities.map(c => ({ id: c.id, rate: c.rate })),
      contentMarketing: capabilities
        .filter(c => ['content-planning', 'content-publishing', 'content-analytics', 'content-review'].includes(c.id))
        .map(c => ({ id: c.id, rate: c.rate, rows: c.rows.map(rowProjection) })),
      versionBombRange: versionErrorText,
      canNotOrphan: orphanRefusal !== null,
      orphanRefusal,
      note: capabilities.length === 12
        ? 'one SQLite catalog holds the graded product-engineering and short-video sets plus the content-marketing assembly set (each carrying preset rows)'
        : 'catalog publish did NOT complete',
    },
    workbenches: {
      count: scenarios.length,
      productEngineering: {
        workbenchId: scenarios.find(s => s.id === 'product-engineering')?.workbenchId,
        capabilities: scenarios.find(s => s.id === 'product-engineering')?.capabilityIds,
        preset: scenarios.find(s => s.id === 'product-engineering')?.preset,
      },
      shortVideoCreation: {
        workbenchId: scenarios.find(s => s.id === 'short-video-creation')?.workbenchId,
        capabilities: scenarios.find(s => s.id === 'short-video-creation')?.capabilityIds,
        preset: scenarios.find(s => s.id === 'short-video-creation')?.preset,
      },
      contentMarketing: {
        workbenchId: scenarios.find(s => s.id === 'content-marketing')?.workbenchId,
        capabilities: scenarios.find(s => s.id === 'content-marketing')?.capabilityIds,
        preset: scenarios.find(s => s.id === 'content-marketing')?.preset,
      },
      heterogeneous: scenarios.length === 3
        && scenarios.find(s => s.id === 'product-engineering')?.workbenchId === 'product-engineering'
        && scenarios.find(s => s.id === 'short-video-creation')?.workbenchId === 'short-video-creation'
        && scenarios.find(s => s.id === 'content-marketing')?.workbenchId === 'content-marketing',
      rosterMount: {
        operator: rosterMount(operator),
        product: rosterMount(product),
        video: rosterMount(video),
        content: rosterMount(content),
      },
      note: scenarios.length === 3
        ? 'each customer group\'s workbench exposes its own capability set and preset binding; the content-marketing workbench binds the ASSEMBLED preset, and roster.mount decides the tool schemas the model sees'
        : 'workbench registration did NOT complete',
    },
    assembly: {
      transitiveResolved: {
        requested: [transitive.requested[0]],
        resolved: [...transitiveChain],
        note: 'assembling test-execution resolves dependency-first: code-analysis → test-case-generation → test-execution (the DFS order IS the edge proof)',
      },
      conflictRejected,
      conflictErrorText,
      versionMismatchRejected,
      versionErrorText,
      refactorFixed: [...refactorFixed.resolved.map(c => c.id)],
      videoResolved: [...videoSet.resolved.map(c => c.id)],
      disabledDependencyRejected,
      rolloutRejected,
      errorCodes: { product: productErrors, video: videoErrors },
      missingDependencyNote: 'CAPABILITY_DEPENDENCY_MISSING cannot be stored through the service: publish validates every dependency edge and the FK chain RESTRICTs deleting a referenced capability, so a dependency edge can never dangle (see catalog.canNotOrphan). The demo proves the nearest reachable case: a gated-off dependency refuses the assembly loudly with CAPABILITY_DISABLED.',
      note: conflictRejected && versionMismatchRejected && disabledDependencyRejected && rolloutRejected
        ? 'every assembly check rejected loudly and the catalog fixes restored resolution'
        : 'an assembly rejection did NOT fire as expected',
    },
    assembler: {
      published: {
        ids: contentCapabilities.map(c => c.id),
        rows: contentCapabilities.flatMap(c => c.rows).map(rowProjection),
      },
      scenario: {
        id: 'content-marketing',
        capabilities: ['content-planning', 'content-publishing', 'content-analytics', 'content-review'],
        preset: 'assembled-content-marketing',
      },
      assembly: {
        request: {
          workspaceId: String(wsProduct),
          scenarioId: 'content-marketing',
          roleId: 'product',
          rolePreset: 'product-engineering',
          preset: 'assembled-content-marketing',
          selected: ['content-planning', 'content-publishing', 'content-analytics'],
        },
        rows: assembledRows.map(rowProjection),
        report: {
          rowIdConflicts: [...reRendered.report.rowIdConflicts],
          toolNameConflicts: [...reRendered.report.toolNameConflicts],
          disabledOnPlatform: [...reRendered.report.disabledOnPlatform],
        },
        audit: auditByAction['market.preset.assemble'] ?? 0,
      },
      determinism: {
        deepEqual: deterministic,
        note: 'rendering the same request twice yields deep-equal rows — the assembler is a pure function of (base, resolved, patches)',
      },
      rejections: {
        rowIdConflict,
        toolNameConflict,
        note: 'a host-supplied base with a duplicate row id and a selection that shadows one tool name across two capabilities both refuse loudly, so neither tree can reach the roster',
      },
      mounted: {
        preset: 'assembled-content-marketing',
        composedPrompt: {
          containsBase,
          containsPlanning,
          containsPublishing,
          containsAnalytics,
          excludesDisabled,
          inCatalogOrder,
        },
        note: containsBase && containsPlanning && containsPublishing && containsAnalytics && excludesDisabled && inCatalogOrder
          ? 'the committed preset mounts and the composed system prompt carries the base persona plus each capability persona in catalog order, minus the platform-disabled row'
          : 'the mounted-surface proof did NOT hold',
      },
      note: rowIdConflict === 'ROW_ID_CONFLICT' && toolNameConflict === 'TOOL_NAME_CONFLICT' && deterministic && inCatalogOrder
        ? 'a non-operator agent rendered + validated a workbench preset tree from a declared capability set; the host committed the rows and the roster mounted them'
        : 'the guided preset assembly did NOT complete as specified',
    },
    gating: {
      disabledCapabilityRefused: disabledDependencyRejected,
      rollout0Refused: rolloutRejected,
      rollout1Admits: transitive.resolved.some(c => c.id === 'test-execution'),
      runtimeGateOpen,
      runtimeGateClosed,
      analyzeOpenText,
      analyzeClosedText,
      gateOpenIsRuntime: productErrors.includes('CAPABILITY_DISABLED'),
      note: 'the assembly-time gate refuses disabled or rollout-excluded capabilities at selection; the runtime gate re-checks the same market gate at tool-call time (analyze_code ran open while code-analysis was enabled, then refused with CAPABILITY_DISABLED at invocation after the operator disabled it)',
    },
    billing: {
      credited: { [String(wsProduct)]: 100, [String(wsVideo)]: 10 },
      balance: { [String(wsProduct)]: wsProductBalance, [String(wsVideo)]: wsVideoBalance },
      wsProductUsage: wsProductUsage.map(row => ({ capabilityId: row.capabilityId, qty: row.qty, cost: row.cost })),
      wsProductSpend,
      wsVideoUsage: wsVideoUsage.map(row => ({ capabilityId: row.capabilityId, qty: row.qty, cost: row.cost })),
      overdraftRejected,
      settlements: settlements,
      settlementsSettled,
      audit: {
        marketCapabilityPublish: auditByAction['market.capability.publish'] ?? 0,
        marketCapabilityUnpublish: auditByAction['market.capability.unpublish'] ?? 0,
        marketCapabilityGate: auditByAction['market.capability.gate'] ?? 0,
        marketScenarioPublish: auditByAction['market.scenario.publish'] ?? 0,
        marketScenarioUnpublish: auditByAction['market.scenario.unpublish'] ?? 0,
        billingCredit: auditByAction['billing.account.credit'] ?? 0,
        billingConsume: auditByAction['billing.consume'] ?? 0,
        billingSettle: auditByAction['billing.settlement.settle'] ?? 0,
      },
      note: overdraftRejected && wsProductSpend === 98 && wsProductBalance === 2
        ? 'the ledger debited 98 credits (8 + 90), refused the third consume on INSUFFICIENT_BALANCE (rolling the failed debit back), and the operator settled the open periods as settled'
        : 'the billing ledger did NOT match the drive',
    },
    referenceEvents,
    traceability: {
      persistedLines: {
        operator: persistedOperator.length,
        product: persistedProduct.length,
        video: persistedVideo.length,
      },
      metaCodes: {
        operator: metaCodes(persistedOperator),
        product: metaCodes(persistedProduct),
        video: metaCodes(persistedVideo),
      },
      uniformlyVisible,
      marketTools,
      note: 'every tool call, result, and market reference event is reconstructable from the persisted JSONL session logs; both workbench agents see the same market tool surface',
    },
    roles: {
      operator: { preset: 'platform-admin', finalText: finalText(operatorEvents) },
      product: { preset: 'product-engineering', finalText: finalText(productEvents) },
      video: { preset: 'short-video-creation', finalText: finalText(videoEvents) },
      creator: { preset: 'product-engineering', finalText: finalText(creatorEvents) },
      content: { preset: 'assembled-content-marketing', finalText: finalText([...content.session.events]) },
    },
    notes: {
      surface: 'persona-only workbench presets — the fs/shell isolation is already proven by the sibling platform-agent-demo; the content-marketing workbench additionally runs the assembled preset',
      scripted: 'keyless mock adapter drove all turns; swap provider to deepseek-official + DEEPSEEK_API_KEY to run live',
    },
  }, null, 2))

  await ctx.fiber.dispose()
  await rm(workdir, { recursive: true, force: true })
}

void main()
