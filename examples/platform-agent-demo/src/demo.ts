import { readFile, readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rm } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { boot, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { applyRolePolicy } from './platform-agent-demo.ts'

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

async function main() {
  loadEnv('platform-agent-demo')

  // A scratch root for the demo's three role workspaces. It must live OUTSIDE the
  // OS temp areas (`/tmp`, `os.tmpdir()`) because the sandbox's workspace-write
  // mode grants those writable to every confined session — a sibling workspace
  // inside them would defeat the cross-role denial. The repo's gitignored
  // `.storages/` root fits; the boot persistence patch also parks the session
  // log here.
  const workdir = join(import.meta.dirname, '..', '..', '..', '.storages', 'platform-agent-demo')
  const productWorkspace = join(workdir, 'product')
  const devWorkspace = join(workdir, 'dev')
  const qaWorkspace = join(workdir, 'qa')
  const persistenceRoot = join(workdir, '.sessions')
  await mkdir(productWorkspace, { recursive: true })
  await mkdir(devWorkspace, { recursive: true })
  await mkdir(qaWorkspace, { recursive: true })

  const ctx = await boot(
    'platform-agent-demo',
    resolveConfigPath(COMPOSE_PATH, undefined),
    [{
      id: 'persistence',
      name: '@deepseek-ai/dsh-session-persistence-jsonl',
      config: {
        root: persistenceRoot,
        compression: 'none',
      },
    }, {
      // The roster's cordis.yml row sets `path: ./presets`, which resolves
      // against the boot process cwd, not this file. Override it with the
      // absolute demo presets dir — the same id-targeted override pattern the
      // persistence row uses.
      id: 'agent-presets',
      name: '@deepseek-ai/dsh-agent-presets',
      config: {
        default: 'product',
        roots: [{ path: PRESETS_ROOT, trust: 'user' }],
        includeUserRoot: false,
      },
    }],
    () => {
      // Nothing to prepare here — the config tree itself mounts the demo plugin
      // and the working directory is derived from the boot process cwd.
    },
  )

  // The roster is the capability-market catalog: it scans the presets dir,
  // assembles an agent by preset id, and recomposes a live agent onto another
  // preset. `mount`/`recompose` below replace the low-level
  // `discoverPresets`/`mountPreset` pair the earlier steps used.
  const roster = ctx.agentPresets
  const catalog = (await roster.list()).map(p => p.id)

  // ── Product agent: authors a requirement and registers it as an asset ────
  await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId('platform-product'),
    agentOptions: { provider: 'platform-demo', model: 'mock-model' },
    meta: { cwd: productWorkspace },
    setup: async (agentCtx) => { await roster.mount(agentCtx, 'product') },
  })
  const product = findAgent(ctx, 'platform-product')
  if (product === undefined) throw new Error('product agent missing')
  product.followup(createUserMessage({
    content: [{ type: 'text', text: 'Author a requirement for a login page with SSO and register it as an asset.' }],
    source: { kind: 'user' },
  }))
  await waitForStatus(ctx, product, 'idle')

  // ── Developer agent: reads the requirement asset and implements it ───────
  // The engine-adapter translation happens here: the dev session is created
  // with ITS exclusive workspace as cwd, and applyRolePolicy seeds the sandbox
  // mode override onto the published session before its first turn. The
  // provider fence enforces it per call — the model never sees the
  // role→workspace map, only the resolved policy.
  await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId('platform-dev'),
    agentOptions: { provider: 'platform-demo', model: 'mock-model' },
    meta: { cwd: devWorkspace },
    setup: async (agentCtx) => { await roster.mount(agentCtx, 'dev') },
  })
  const dev = findAgent(ctx, 'platform-dev')
  if (dev === undefined) throw new Error('dev agent missing')
  applyRolePolicy(dev.session, 'workspace-write')
  dev.followup(createUserMessage({
    content: [{ type: 'text', text: 'Read the product requirement, implement it in the working directory, then register the produced code.' }],
    source: { kind: 'user' },
  }))
  await waitForStatus(ctx, dev, 'idle')

  // ── QA agent: verifies the produced code and registers test cases ─────────
  // The QA session is created with ITS exclusive workspace as cwd. Its preset
  // mounts only read-only inspection tools (glob/grep) — no write/edit, no
  // shell — so it can review the code asset but never mutate a working
  // directory. The mock chain: get_asset(code-2) → register_asset(test-case),
  // extending the lineage to requirement-1 → code-2 → test-case-3.
  await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId('platform-qa'),
    agentOptions: { provider: 'platform-demo', model: 'mock-model' },
    meta: { cwd: qaWorkspace },
    setup: async (agentCtx) => { await roster.mount(agentCtx, 'qa') },
  })
  const qa = findAgent(ctx, 'platform-qa')
  if (qa === undefined) throw new Error('qa agent missing')
  qa.followup(createUserMessage({
    content: [{ type: 'text', text: 'Read the developer\'s code asset, verify it in the working directory, then register the test cases you derived.' }],
    source: { kind: 'user' },
  }))
  await waitForStatus(ctx, qa, 'idle')

  // Capture the cross-role handoff chain the three demo roles produced, BEFORE
  // the assembler and quota agents register their own assets. The chain
  // requirement-1 → code-2 → test-case-3 is the durable lineage D7 promises:
  // each role reads the previous role's asset and registers its own.
  const assets = {
    product: ctx.platformService.listAssets('product'),
    dev: ctx.platformService.listAssets('dev'),
    qa: ctx.platformService.listAssets('qa'),
  }
  const lineageIds = assets.product.concat(assets.dev, assets.qa).map(a => a.id)

  // ── Assembler agent: the capability market assembles it by id ────────────
  // T7: a bare agent is created with NO preset, its tool surface is the empty
  // global layer; then the roster `recompose` binds it to the dev preset's
  // standing mount (allowed while the session is blank — the swap is a parent
  // re-link, not an unmount). The durable `agent-preset/selected` event is
  // appended after the swap committed, mirroring the api-proxy recompose
  // pattern: the log states what the agent runs, and a rejected mount leaves
  // the previous composition.
  const assemblerWorkspace = join(workdir, 'assembler')
  await mkdir(assemblerWorkspace, { recursive: true })
  await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId('platform-assembler'),
    agentOptions: { provider: 'platform-demo', model: 'mock-model' },
    meta: { cwd: assemblerWorkspace },
    // No `setup` mount: this agent is created bare, exactly what the roster
    // is designed to assemble.
  })
  const assembler = findAgent(ctx, 'platform-assembler')
  if (assembler === undefined) throw new Error('assembler agent missing')
  const assemblerToolsBefore = ctx.tools.schemas(scopeOf(assembler.ctx)).map(s => s.name).sort()
  const assemblerPresetBefore = roster.composedPreset(assembler.ctx) ?? null
  await roster.recompose(assembler.ctx, 'dev')
  assembler.session.append('agent-preset/selected', { agentPreset: 'dev' })
  const assemblerComposed = roster.composedPreset(assembler.ctx)
  assembler.followup(createUserMessage({
    content: [{ type: 'text', text: 'Read the product requirement, implement it in the working directory, then register the produced code.' }],
    source: { kind: 'user' },
  }))
  await waitForStatus(ctx, assembler, 'idle')
  const assemblerToolsAfter = ctx.tools.schemas(scopeOf(assembler.ctx)).map(s => s.name).sort()

  // ── Quota pair: two more workspaces share this runtime, quotas distinct ───
  // T5: multiple workspaces share ONE process tree, and each session's output
  // budget is a per-session `maxTokens` enforced at the provider boundary — the
  // adapter receives it on the generation request and finishes with `max-tokens`
  // when the reply would exceed it. The two quota agents run the same mock task
  // with different caps, so the JSON shows the same runtime enforcing each
  // workspace's own quota.
  const quotaWorkspace = join(workdir, 'quota-product')
  const quotaDevWorkspace = join(workdir, 'quota-dev')
  await mkdir(quotaWorkspace, { recursive: true })
  await mkdir(quotaDevWorkspace, { recursive: true })
  const QUOTA_TIGHT = 24
  const QUOTA_LOOSE = 120
  await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId('platform-quota-tight'),
    agentOptions: { provider: 'platform-demo', model: 'mock-model', maxTokens: QUOTA_TIGHT },
    meta: { cwd: quotaWorkspace },
    setup: async (agentCtx) => { await roster.mount(agentCtx, 'product') },
  })
  const quotaTight = findAgent(ctx, 'platform-quota-tight')
  if (quotaTight === undefined) throw new Error('quota-tight agent missing')
  quotaTight.followup(createUserMessage({
    content: [{ type: 'text', text: 'Author a requirement for a login page with SSO and register it as an asset.' }],
    source: { kind: 'user' },
  }))
  await waitForStatus(ctx, quotaTight, 'idle')
  await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId('platform-quota-loose'),
    agentOptions: { provider: 'platform-demo', model: 'mock-model', maxTokens: QUOTA_LOOSE },
    meta: { cwd: quotaDevWorkspace },
    setup: async (agentCtx) => { await roster.mount(agentCtx, 'dev') },
  })
  const quotaLoose = findAgent(ctx, 'platform-quota-loose')
  if (quotaLoose === undefined) throw new Error('quota-loose agent missing')
  quotaLoose.followup(createUserMessage({
    content: [{ type: 'text', text: 'Author a requirement for a login page with SSO and register it as an asset.' }],
    source: { kind: 'user' },
  }))
  await waitForStatus(ctx, quotaLoose, 'idle')

  // ── Present the traceable outcome ─────────────────────────────────────────
  // Reach durable storage before reading it back: the JSONL backend batches
  // `session/event` appends on a fixed timer, so flush each session's buffered
  // events through the store's `session/flush` barrier. `SessionStore.flush` is
  // the one owner of the flush carrier.
  await ctx.sessions.flush(product.session)
  await ctx.sessions.flush(dev.session)
  await ctx.sessions.flush(qa.session)
  await ctx.sessions.flush(assembler.session)
  await ctx.sessions.flush(quotaTight.session)
  await ctx.sessions.flush(quotaLoose.session)
  const productEvents = [...product.session.events]
  const devEvents = [...dev.session.events]
  const qaEvents = [...qa.session.events]
  const assemblerEvents = [...assembler.session.events]
  const quotaTightEvents = [...quotaTight.session.events]
  const quotaLooseEvents = [...quotaLoose.session.events]
  const productCalls = productEvents.filter(e => e.type === 'tool/call').map(e => e.data.name)
  const devCalls = devEvents.filter(e => e.type === 'tool/call').map(e => e.data.name)
  const qaCalls = qaEvents.filter(e => e.type === 'tool/call').map(e => e.data.name)
  const assemblerCalls = assemblerEvents.filter(e => e.type === 'tool/call').map(e => e.data.name)
  // The dev session holds the full ACL-denial → escalation → approval chain,
  // so its persisted log is the audit surface for both T4 and T6.
  const persistedDev = await readPersistedEvents(persistenceRoot, 'platform-dev')
  // The assembler session is the T7 audit surface: its persisted log records
  // the `agent-preset/selected` event that names the preset it was assembled
  // onto after creation.
  const persistedAssembler = await readPersistedEvents(persistenceRoot, 'platform-assembler')
  const assemblerSelectionPersisted = persistedAssembler.some(e => e.type === 'agent-preset/selected')
  const assemblerSelectionData = persistedAssembler
    .filter((e): e is Extract<SessionEvent, { type: 'agent-preset/selected' }> => e.type === 'agent-preset/selected')
    .map(e => e.data.agentPreset)

  // T5 quota evidence: each quota session's recorded usage vs its `maxTokens`
  // cap, and the durable `turn/end` reason. `maxTokens` caps a SINGLE
  // generation step's output tokens, so the metric is the largest step usage,
  // not the turn total. The header carries the cap in its persisted config, so
  // the quota is a per-session record, not a loop-global.
  const quotaSession = (events: SessionEvent[]) => {
    const usageEvents = events.filter((e): e is Extract<SessionEvent, { type: 'assistant/message' }> =>
      e.type === 'assistant/message' && e.data.usage !== undefined)
    const maxStepOutput = usageEvents.reduce((max, e) => Math.max(max, e.data.usage?.outputTokens ?? 0), 0)
    const turnEnd = events.findLast((e): e is Extract<SessionEvent, { type: 'turn/end' }> => e.type === 'turn/end')
    return { maxStepOutput, reason: turnEnd?.data.reason.kind ?? null }
  }
  const tight = quotaSession(quotaTightEvents)
  const loose = quotaSession(quotaLooseEvents)
  const tightCapped = tight.maxStepOutput <= QUOTA_TIGHT && tight.reason === 'max-tokens'
  const looseUncapped = loose.maxStepOutput <= QUOTA_LOOSE && loose.reason === 'completed'
  const tightHeader = quotaTight.session.requestHeader()?.config.maxTokens ?? null
  const looseHeader = quotaLoose.session.requestHeader()?.config.maxTokens ?? null

  // Tool surfaces: the clearest evidence of role isolation. `tools.schemas()`
  // takes a scope key; `scopeOf(agent.ctx)` is that agent's scope tag, so the
  // projection shows exactly the model-visible catalog for that role's surface.
  const productTools = ctx.tools.schemas(scopeOf(product.ctx)).map(s => s.name).sort()
  const devTools = ctx.tools.schemas(scopeOf(dev.ctx)).map(s => s.name).sort()
  const qaTools = ctx.tools.schemas(scopeOf(qa.ctx)).map(s => s.name).sort()
  const productOnly = productTools.filter(name => !devTools.includes(name))
  const devOnly = devTools.filter(name => !productTools.includes(name))
  // QA's preset is read-only inspection: it gains the search tools but must
  // NOT gain the mutating code-world tools the dev preset mounts. `qaReadOnly`
  // names exactly those absent mutators — the proof that QA cannot write/edit
  // or run shell, even though its sibling role can.
  const qaReadOnly = ['write', 'edit', 'bash', 'pwsh'].filter(name => devTools.includes(name) && !qaTools.includes(name))

  // T4 ACL evidence from the dev session log: the out-of-workspace `write`
  // attempt, its structured `FS_SANDBOX_DENIED` error, and the model-facing
  // marker. The persisted log is the audit surface — the denial is durable.
  const aclCallEvent = devEvents.find((e): e is Extract<SessionEvent, { type: 'tool/call' }> =>
    e.type === 'tool/call' && e.data.name === 'write' && e.data.arguments.includes('pii-leak'))
  const aclResultEvent = devEvents.find((e): e is Extract<SessionEvent, { type: 'tool/result' }> =>
    e.type === 'tool/result'
    && String(e.data.message.content.at(0)?.toolCallId ?? '').includes('acl'))
  const aclResultBlock = aclResultEvent?.data.message.content[0]
  const aclResultText = aclResultBlock?.content.map(b => b.type === 'text' ? b.text : '').join('') ?? ''
  const deniedError = aclResultEvent?.data.error
  const denied = deniedError?.code === 'FS_SANDBOX_DENIED'
  const deniedRequested = aclCallEvent?.data.arguments ?? null
  const deniedExcluded = denied ? deniedError.code : null
  const deniedHasContent = denied ? aclResultText.includes('[sandbox:') : null

  // T6 approval evidence from the dev session log: the escalation retry
  // (sandbox_permissions + justification), the scripted answerer's grant
  // (approval/decided = allowed-once), the second write's actual execution,
  // and the durable approval/asked + approval/decided audit pair.
  const escalateCallEvent = devEvents.find((e): e is Extract<SessionEvent, { type: 'tool/call' }> =>
    e.type === 'tool/call' && e.data.name === 'write' && e.data.arguments.includes('danger-full-access'))
  const escalateResultEvent = devEvents.find((e): e is Extract<SessionEvent, { type: 'tool/result' }> =>
    e.type === 'tool/result'
    && String(e.data.message.content.at(0)?.toolCallId ?? '').includes('escalate'))
  const approvalDecidedEvent = devEvents.find((e): e is Extract<SessionEvent, { type: 'approval/decided' }> =>
    e.type === 'approval/decided')
  const approvalAskedEvent = devEvents.find((e): e is Extract<SessionEvent, { type: 'approval/asked' }> =>
    e.type === 'approval/asked')
  const approvalOutcome = approvalDecidedEvent?.data.outcome ?? null
  const escalationSucceeded = escalateResultEvent?.data.error === undefined
  const auditPairPersisted = persistedDev.some(e => e.type === 'approval/asked')
    && persistedDev.some(e => e.type === 'approval/decided')
  const approvalAskedReason = approvalAskedEvent?.data.reason ?? null
  const approvalGranted = approvalOutcome === 'allowed-once'

  console.log(JSON.stringify({
    roles: {
      product: {
        preset: 'product',
        toolsUsed: productCalls,
        toolCatalog: productTools,
        finalText: finalText(productEvents),
        assetsProduced: assets.product,
      },
      dev: {
        preset: 'dev',
        toolsUsed: devCalls,
        toolCatalog: devTools,
        finalText: finalText(devEvents),
        assetsProduced: assets.dev,
      },
      qa: {
        preset: 'qa',
        toolsUsed: qaCalls,
        toolCatalog: qaTools,
        finalText: finalText(qaEvents),
        assetsProduced: assets.qa,
      },
      assembler: {
        presetBefore: assemblerPresetBefore,
        presetAfter: assemblerComposed,
        toolsUsed: assemblerCalls,
        toolCatalog: assemblerToolsAfter,
        finalText: finalText(assemblerEvents),
      },
    },
    roleIsolation: {
      productOnlyTools: productOnly,
      devOnlyTools: devOnly,
      qaReadOnlyTools: qaReadOnly,
    },
    marketAssembly: {
      rosterCatalog: catalog,
      assemblerPresetBefore: assemblerPresetBefore,
      assemblerToolsBefore: assemblerToolsBefore,
      assemblerPresetAfter: assemblerComposed,
      assemblerToolsAfter: assemblerToolsAfter,
      gainedDevTools: assemblerToolsAfter.filter(name => !assemblerToolsBefore.includes(name)),
      selectionPersisted: assemblerSelectionPersisted,
      selectionData: assemblerSelectionData,
      assemblerEvents: assemblerEvents.length,
      note: assemblerPresetBefore === null && assemblerComposed === 'dev'
        ? 'a bare agent was created with no preset, recomposed onto the dev preset by id, and its tool surface gained the dev catalog'
        : 'assembly did NOT complete — the capability market failed',
    },
    quotaEnforcement: {
      sharedProcess: true,
      tight: {
        workspace: 'quota-product',
        maxTokens: QUOTA_TIGHT,
        headerMaxTokens: tightHeader,
        maxStepOutput: tight.maxStepOutput,
        reason: tight.reason,
        respected: tight.maxStepOutput <= QUOTA_TIGHT,
        capped: tightCapped,
      },
      loose: {
        workspace: 'quota-dev',
        maxTokens: QUOTA_LOOSE,
        headerMaxTokens: looseHeader,
        maxStepOutput: loose.maxStepOutput,
        reason: loose.reason,
        respected: loose.maxStepOutput <= QUOTA_LOOSE,
        capped: looseUncapped,
      },
      note: tightCapped && looseUncapped
        ? 'two workspaces share one runtime; each session output budget was enforced at the provider boundary (tight ended max-tokens, loose completed under its cap)'
        : 'quota was NOT enforced — T5 failed',
    },
    aclEnforcement: {
      enforcedCwd: dev.session.header.cwd,
      attemptedWrite: deniedRequested,
      deniedBy: deniedExcluded,
      deniedWithMarker: deniedHasContent,
      deniedMarkerText: denied ? aclResultText.slice(0, 120) : '',
      note: denied
        ? 'dev write to the sibling product workspace was denied at the fs provider boundary (FS_SANDBOX_DENIED)'
        : 'dev write was NOT denied — ACL failed',
    },
    approvalEnforcement: {
      escalationCall: escalateCallEvent?.data.arguments ?? null,
      approvalAskedReason: approvalAskedReason,
      approvalOutcome: approvalOutcome,
      grantedMode: approvalGranted ? 'danger-full-access' : null,
      finalWriteSucceeded: escalationSucceeded,
      auditPairPersisted: auditPairPersisted,
      note: approvalGranted && escalationSucceeded
        ? 'the sandbox-denied write was retried with sandbox_permissions + justification, approved by the answerer (allowed-once), and executed'
        : 'escalation did NOT complete — the approval seam failed',
    },
    traceability: {
      productEvents: productEvents.length,
      devEvents: devEvents.length,
      qaEvents: qaEvents.length,
      assemblerEvents: assemblerEvents.length,
      quotaTightEvents: quotaTightEvents.length,
      quotaLooseEvents: quotaLooseEvents.length,
      persistedDevLogLines: persistedDev.length,
      persistedSample: persistedDev.slice(-3).map(e => e.type),
    },
    lineage: {
      ids: lineageIds,
      chainComplete: lineageIds.join(' → ') === 'requirement-1 → code-2 → test-case-3',
      note: 'each role read the previous role\'s asset and registered its own, so the cross-role trace is durable (D7)',
    },
    notes: {
      productTools: 'product preset exposes NO shell/fs/code tools',
      devTools: 'dev preset exposes fs + shell + asset registry',
      qaTools: 'qa preset exposes read-only search only (glob/grep) — no write/edit/shell',
      assembler: 'bare agent assembled onto the dev preset by the roster (T7)',
      quota: 'per-workspace maxTokens enforced at the provider boundary under one shared runtime (T5)',
      scripted: 'keyless mock adapter drove all turns; swap provider to deepseek-official + DEEPSEEK_API_KEY to run live',
    },
  }, null, 2))

  await ctx.fiber.dispose()
  await rm(workdir, { recursive: true, force: true })
}

void main()
