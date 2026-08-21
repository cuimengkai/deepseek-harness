import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { boot, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { RoleId } from '@deepseek-ai/dsh-experimental-platform-shell/src/types.ts'
import { bindActor } from './platform-shell-demo.ts'

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
  loadEnv('platform-shell-demo')

  // A scratch root for the demo's one control-plane SQLite database and the
  // persisted session logs. Repo-local `.storages/` keeps it gitignored.
  const workdir = join(import.meta.dirname, '..', '..', '..', '.storages', 'platform-shell-demo')
  const persistenceRoot = join(workdir, '.sessions')
  const roleWorkspaces = ['alice', 'dev', 'qa', 'admin', 'mallory'].map(role => join(workdir, role))
  await mkdir(workdir, { recursive: true })
  await mkdir(persistenceRoot, { recursive: true })
  await Promise.all(roleWorkspaces.map(dir => mkdir(dir, { recursive: true })))

  const ctx = await boot(
    'platform-shell-demo',
    resolveConfigPath(COMPOSE_PATH, undefined),
    [{
      // The roster's cordis.yml row sets `path: ./presets`, which resolves
      // against the boot process cwd. Override it with the absolute demo
      // presets dir — the same id-targeted override pattern the persistence
      // row uses.
      id: 'agent-presets',
      name: '@deepseek-ai/dsh-agent-presets',
      config: {
        default: 'product',
        roots: [{ path: PRESETS_ROOT, trust: 'user' }],
        includeUserRoot: false,
      },
    }, {
      // Session logs land in a fresh scratch root instead of the checked-in
      // `.platform-shell-demo-sessions` default.
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

  // ── tenant: one workspace, four members, one non-member ───────────────────
  const shell = ctx.platformShell
  const ws1 = shell.createWorkspace('Platform')
  const alice = shell.registerUser('Alice')
  const bob = shell.registerUser('Bob')
  const carol = shell.registerUser('Carol')
  const dana = shell.registerUser('Dana')
  const mallory = shell.registerUser('Mallory')
  shell.assignRole(ws1, alice, RoleId('product'))
  shell.assignRole(ws1, bob, RoleId('dev'))
  shell.assignRole(ws1, carol, RoleId('qa'))
  shell.assignRole(ws1, dana, RoleId('platform-admin'))
  // Mallory is deliberately NOT a member of ws1 — her read denial below is the
  // RBAC proof at the model boundary.

  // Bind each agent session to the platform user acting through it.
  bindActor('platform-alice', alice)
  bindActor('platform-dev', bob)
  bindActor('platform-qa', carol)
  bindActor('platform-admin', dana)
  bindActor('platform-mallory', mallory)

  // The workspace id is allocated at boot (`ws-<timestamp>`), so each agent's
  // task names it explicitly and the scripted model reads it back.
  const tasks = {
    alice: `Author a requirement for a login page with SSO, register it in workspace ${ws1}, then submit it for business approval.`,
    dev: `Read the product requirement asset and implement it, then register the produced code in workspace ${ws1}.`,
    qa: `Read the developer's code asset, verify it, and register the test cases you derived in workspace ${ws1}.`,
    admin: `The approved requirement ticket is waiting for release in workspace ${ws1}. Release it.`,
    mallory: `Read the requirement asset in workspace ${ws1}.`,
  }

  const roster = ctx.agentPresets

  // ── Product agent: register requirement-1, submit + drive the approval ────
  await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId('platform-alice'),
    agentOptions: { provider: 'platform-demo', model: 'mock-model' },
    meta: { cwd: join(workdir, 'alice') },
    setup: async (agentCtx) => { await roster.mount(agentCtx, 'product') },
  })
  const aliceAgent = findAgent(ctx, 'platform-alice')
  if (aliceAgent === undefined) throw new Error('alice agent missing')
  aliceAgent.followup(createUserMessage({
    content: [{ type: 'text', text: tasks.alice }],
    source: { kind: 'user' },
  }))
  await waitForStatus(ctx, aliceAgent, 'idle')

  // ── Developer agent: read requirement-1, register code-2, link it ─────────
  await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId('platform-dev'),
    agentOptions: { provider: 'platform-demo', model: 'mock-model' },
    meta: { cwd: join(workdir, 'dev') },
    setup: async (agentCtx) => { await roster.mount(agentCtx, 'dev') },
  })
  const devAgent = findAgent(ctx, 'platform-dev')
  if (devAgent === undefined) throw new Error('dev agent missing')
  devAgent.followup(createUserMessage({
    content: [{ type: 'text', text: tasks.dev }],
    source: { kind: 'user' },
  }))
  await waitForStatus(ctx, devAgent, 'idle')

  // ── QA agent: read code-2, register test-case-3, link + trace it ──────────
  await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId('platform-qa'),
    agentOptions: { provider: 'platform-demo', model: 'mock-model' },
    meta: { cwd: join(workdir, 'qa') },
    setup: async (agentCtx) => { await roster.mount(agentCtx, 'qa') },
  })
  const qaAgent = findAgent(ctx, 'platform-qa')
  if (qaAgent === undefined) throw new Error('qa agent missing')
  qaAgent.followup(createUserMessage({
    content: [{ type: 'text', text: tasks.qa }],
    source: { kind: 'user' },
  }))
  await waitForStatus(ctx, qaAgent, 'idle')

  // The review scope granted at approval is held on the ticket while it is
  // `approved`; the release transition clears it, so snapshot it now (after
  // alice's turn, before the admin releases) as the approved(scope) proof.
  const scopeAtApproval = shell.listTickets(alice, ws1)[0]?.reviewScope ?? null

  // ── Platform admin agent: list the ticket, release it ─────────────────────
  await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId('platform-admin'),
    agentOptions: { provider: 'platform-demo', model: 'mock-model' },
    meta: { cwd: join(workdir, 'admin') },
    setup: async (agentCtx) => { await roster.mount(agentCtx, 'platform-admin') },
  })
  const adminAgent = findAgent(ctx, 'platform-admin')
  if (adminAgent === undefined) throw new Error('admin agent missing')
  adminAgent.followup(createUserMessage({
    content: [{ type: 'text', text: tasks.admin }],
    source: { kind: 'user' },
  }))
  await waitForStatus(ctx, adminAgent, 'idle')

  // ── Mallory (bare agent, no preset): her read is denied by RBAC ───────────
  await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId('platform-mallory'),
    agentOptions: { provider: 'platform-demo', model: 'mock-model' },
    meta: { cwd: join(workdir, 'mallory') },
  })
  const malloryAgent = findAgent(ctx, 'platform-mallory')
  if (malloryAgent === undefined) throw new Error('mallory agent missing')
  malloryAgent.followup(createUserMessage({
    content: [{ type: 'text', text: tasks.mallory }],
    source: { kind: 'user' },
  }))
  await waitForStatus(ctx, malloryAgent, 'idle')

  // ── Durable evidence: flush, then read the persisted logs back ────────────
  await ctx.sessions.flush(aliceAgent.session)
  await ctx.sessions.flush(devAgent.session)
  await ctx.sessions.flush(qaAgent.session)
  await ctx.sessions.flush(adminAgent.session)
  await ctx.sessions.flush(malloryAgent.session)
  const aliceEvents = [...aliceAgent.session.events]
  const devEvents = [...devAgent.session.events]
  const qaEvents = [...qaAgent.session.events]
  const adminEvents = [...adminAgent.session.events]
  const malloryEvents = [...malloryAgent.session.events]
  const toolCalls = (events: SessionEvent[]): string[] =>
    events.filter(e => e.type === 'tool/call').map(e => e.data.name)
  const catalogs = (agent: Agent): string[] =>
    ctx.tools.schemas(scopeOf(agent.ctx)).map(s => s.name).sort()
  const persisted = async (sessionId: string): Promise<SessionEvent[]> =>
    readPersistedEvents(persistenceRoot, sessionId)
  const persistedAlice = await persisted('platform-alice')
  const persistedDev = await persisted('platform-dev')
  const persistedQa = await persisted('platform-qa')
  const persistedAdmin = await persisted('platform-admin')
  const persistedMallory = await persisted('platform-mallory')
  // The model-visible ⟺ logged proof: each platform tool's presentationMeta
  // lands in the PERSISTED tool/result event, not just the in-memory one. The
  // tool-owned meta is opaque JsonValue, so narrow the object form explicitly.
  const metaCodes = (events: SessionEvent[]): (string | null | undefined)[] =>
    events.filter((e): e is Extract<SessionEvent, { type: 'tool/result' }> => e.type === 'tool/result')
      .map((e) => {
        const meta = e.data.meta
        return meta !== null && typeof meta === 'object' && !Array.isArray(meta) && typeof meta.code === 'string'
          ? meta.code
          : null
      })

  // ── Store-level facts ─────────────────────────────────────────────────────
  const assets = shell.listAssets(alice, ws1)
  const assetIds = assets.map(a => a.id)
  const requirementId = assets.find(a => a.kind === 'requirement')?.id
  const testCaseId = assets.find(a => a.kind === 'test-case')?.id
  const requirementDescendants = requirementId === undefined
    ? []
    : shell.descendants(alice, requirementId).map(e => e.assetId)
  const testCaseAncestors = testCaseId === undefined
    ? []
    : shell.ancestors(alice, testCaseId).map(e => e.parentId)
  const ticket = shell.listTickets(alice, ws1)[0]
  const storeTransitions = ticket === undefined
    ? []
    : shell.transitions(alice, ticket.id).map(t => `${String(t.from)}→${t.to}`)
  const auditRows = shell.listAudit(dana, { workspaceId: ws1 })
  const auditByAction = auditRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.action] = (acc[row.action] ?? 0) + 1
    return acc
  }, {})
  const sessionTransitions = [...aliceEvents, ...adminEvents]
    .filter((e): e is Extract<SessionEvent, { type: 'platform/approval/transition' }> => e.type === 'platform/approval/transition')
    .map(e => `${String(e.data.from)}→${e.data.to}`)
  const malloryDenial = persistedMallory.find((e): e is Extract<SessionEvent, { type: 'tool/result' }> =>
    e.type === 'tool/result' && e.data.error?.code === 'PERMISSION_DENIED')
  const catalogAlice = catalogs(aliceAgent)
  const catalogDev = catalogs(devAgent)
  const catalogQa = catalogs(qaAgent)
  const catalogAdmin = catalogs(adminAgent)
  const catalogMallory = catalogs(malloryAgent)
  const shellTools = ['register_asset', 'get_asset', 'approve_ticket', 'audit_query',
    'submit_ticket', 'link_asset', 'get_ticket', 'list_tickets', 'asset_ancestors', 'asset_descendants']

  const chainComplete = requirementId !== undefined && testCaseId !== undefined
    && [...requirementDescendants].sort().join(',') === 'code-2,test-case-3'
    && [...testCaseAncestors].sort().join(',') === 'code-2,requirement-1'
  const chain = sessionTransitions.join(' → ') === 'null→draft → draft→review → review→approved → approved→released'
  const uniformlyVisible = shellTools.every(tool =>
    [catalogAlice, catalogDev, catalogQa, catalogAdmin, catalogMallory].every(catalog => catalog.includes(tool)))

  console.log(JSON.stringify({
    tenant: {
      workspace: ws1,
      memberships: [alice, bob, carol, dana].map(userId => ({
        user: userId,
        role: shell.membership(userId, ws1)?.roleId,
      })),
      malloryNotMember: shell.membership(mallory, ws1) === undefined,
    },
    roles: {
      alice: {
        preset: 'product',
        toolsUsed: toolCalls(aliceEvents),
        finalText: finalText(aliceEvents),
        assetsProduced: assets.filter(a => a.roleId === RoleId('product')).map(a => a.id),
      },
      dev: {
        preset: 'dev',
        toolsUsed: toolCalls(devEvents),
        finalText: finalText(devEvents),
        assetsProduced: assets.filter(a => a.roleId === RoleId('dev')).map(a => a.id),
      },
      qa: {
        preset: 'qa',
        toolsUsed: toolCalls(qaEvents),
        finalText: finalText(qaEvents),
        assetsProduced: assets.filter(a => a.roleId === RoleId('qa')).map(a => a.id),
      },
      admin: {
        preset: 'platform-admin',
        toolsUsed: toolCalls(adminEvents),
        finalText: finalText(adminEvents),
      },
      mallory: {
        preset: null,
        toolsUsed: toolCalls(malloryEvents),
        finalText: finalText(malloryEvents),
      },
    },
    controlPlaneSurface: {
      uniformlyVisible,
      shellTools,
      malloryCatalog: catalogMallory,
    },
    lineage: {
      assetIds: [...assetIds].sort(),
      chainComplete,
      requirementDescendants: [...requirementDescendants].sort(),
      testCaseAncestors: [...testCaseAncestors].sort(),
      referenceEventsPersisted: {
        alice: persistedAlice.filter(e => e.type === 'asset/register').length,
        dev: persistedDev.filter(e => e.type === 'asset/read' || e.type === 'asset/register').length,
        qa: persistedQa.filter(e => e.type === 'asset/read' || e.type === 'asset/register').length,
      },
      note: chainComplete
        ? 'each role registered its asset and linked it to the previous role\'s, forming requirement-1 → code-2 → test-case-3'
        : 'lineage did NOT chain — the store or the demo drive failed',
    },
    approval: {
      ticketId: ticket?.id ?? null,
      status: ticket?.status ?? null,
      scopeAtApproval: scopeAtApproval === null ? null : {
        roles: [...scopeAtApproval.roles],
        workspace: scopeAtApproval.workspace,
      },
      scopeGranted: scopeAtApproval?.roles.some(role => role === RoleId('product')) ?? false,
      storeTransitions,
      sessionTransitions,
      chain,
      note: ticket?.status === 'released' && chain && scopeAtApproval !== null
        ? 'product drove draft→review→approved with a product scope; the platform-admin released; every step persisted as platform/approval/transition'
        : 'approval did NOT complete — the state machine or the drive failed',
    },
    rbacDenial: {
      malloryTool: 'get_asset',
      deniedPersisted: malloryDenial !== undefined,
      deniedCode: malloryDenial?.data.error?.code ?? null,
      note: malloryDenial !== undefined
        ? 'mallory is a registered user but not a workspace member — her read was denied at the service boundary with PERMISSION_DENIED and the denial is durable'
        : 'mallory\'s read was NOT denied — RBAC failed',
    },
    audit: {
      rows: auditRows.length,
      byAction: auditByAction,
      assetRegister: auditByAction['asset.register'] ?? 0,
      assetRead: auditByAction['asset.read'] ?? 0,
      approvalSubmit: auditByAction['approval.submit'] ?? 0,
      approvalTransition: auditByAction['approval.transition'] ?? 0,
      lineageLink: auditByAction['lineage.link'] ?? 0,
      note: auditByAction['asset.register'] === 3 && auditByAction['asset.read'] === 2 && auditByAction['lineage.link'] === 2
        ? 'each mutation wrote one audit row in the same transaction as the store commit; mallory\'s denied read wrote none'
        : 'audit did NOT match the drive — the mutation/audit pairing failed',
    },
    traceability: {
      aliceEvents: aliceEvents.length,
      devEvents: devEvents.length,
      qaEvents: qaEvents.length,
      adminEvents: adminEvents.length,
      malloryEvents: malloryEvents.length,
      persistedLines: {
        alice: persistedAlice.length,
        dev: persistedDev.length,
        qa: persistedQa.length,
        admin: persistedAdmin.length,
        mallory: persistedMallory.length,
      },
      metaCodes: {
        alice: metaCodes(persistedAlice),
        dev: metaCodes(persistedDev),
        qa: metaCodes(persistedQa),
        admin: metaCodes(persistedAdmin),
        mallory: metaCodes(persistedMallory),
      },
      note: 'every tool call, result, and platform reference event is reconstructable from the persisted JSONL session logs',
    },
    notes: {
      surface: 'persona-only role presets — the fs/shell isolation is already proven by the sibling platform-agent-demo',
      scripted: 'keyless mock adapter drove all turns; swap provider to deepseek-official + DEEPSEEK_API_KEY to run live',
    },
  }, null, 2))

  await ctx.fiber.dispose()
  await rm(workdir, { recursive: true, force: true })
}

void main()
