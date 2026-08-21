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
import { CapabilityId, RoleId, ScenarioId } from '@deepseek-ai/dsh-experimental-platform-shell/src/types.ts'
import { bindActor } from './capability-market-demo.ts'

const COMPOSE_PATH = fileURLToPath(new URL('../cordis.yml', import.meta.url))
const PRESETS_ROOT = fileURLToPath(new URL('../presets', import.meta.url))

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

/** The market tools registered by the platform-shell consumer. */
const marketTools = ['publish_capability', 'list_capabilities', 'assemble_capabilities',
  'set_capability_gate', 'publish_scenario', 'list_scenarios',
  'consume_capability', 'account_balance', 'settle_account'].sort()

async function main() {
  loadEnv('capability-market-demo')

  // A scratch root for the demo's one control-plane SQLite database and the
  // persisted session logs. Repo-local `.storages/` keeps it gitignored. Clear
  // any prior run's leftover (a crashed run must not collide with a new one).
  const workdir = join(import.meta.dirname, '..', '..', '..', '.storages', 'capability-market-demo')
  const persistenceRoot = join(workdir, '.sessions')
  const roleWorkspaces = ['operator', 'product', 'video'].map(role => join(workdir, role))
  await rm(workdir, { recursive: true, force: true })
  await mkdir(workdir, { recursive: true })
  await mkdir(persistenceRoot, { recursive: true })
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
        roots: [{ path: PRESETS_ROOT, trust: 'user' }],
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

  // Bind each agent session to the platform user acting through it.
  bindActor('market-operator', admin)
  bindActor('market-product', alice)
  bindActor('market-video', bob)

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

  // ── 7. Operator closes both billing periods ───────────────────────────────
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
      versionBombRange: versionErrorText,
      canNotOrphan: orphanRefusal !== null,
      orphanRefusal,
      note: capabilities.length === 8
        ? 'one SQLite catalog holds the graded product-engineering and short-video capability sets'
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
      heterogeneous: scenarios.length === 2
        && scenarios.find(s => s.id === 'product-engineering')?.workbenchId === 'product-engineering'
        && scenarios.find(s => s.id === 'short-video-creation')?.workbenchId === 'short-video-creation',
      rosterMount: {
        operator: rosterMount(operator),
        product: rosterMount(product),
        video: rosterMount(video),
      },
      note: scenarios.length === 2
        ? 'each customer group\'s workbench exposes its own capability set and preset binding; roster.mount binds the agent\'s scope chain to the workbench preset (composedPreset), which decides the tool schemas the model sees'
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
    gating: {
      disabledCapabilityRefused: disabledDependencyRejected,
      rollout0Refused: rolloutRejected,
      rollout1Admits: transitive.resolved.some(c => c.id === 'test-execution'),
      note: 'a disabled capability refuses any assembly that reaches it (directly or as a dependency); a rollout-0 capability refuses every workspace; rollout 1 admits all',
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
    },
    notes: {
      surface: 'persona-only workbench presets — the fs/shell isolation is already proven by the sibling platform-agent-demo',
      scripted: 'keyless mock adapter drove all turns; swap provider to deepseek-official + DEEPSEEK_API_KEY to run live',
    },
  }, null, 2))

  await ctx.fiber.dispose()
  await rm(workdir, { recursive: true, force: true })
}

void main()
