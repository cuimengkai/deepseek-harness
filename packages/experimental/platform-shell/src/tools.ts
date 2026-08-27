/**
 * Model-visible platform shell tools: the consumer of the PlatformShellService
 * that role agents drive. Every tool binds its actor from the calling session
 * (the demo maps `session.id → platform user`), enforces RBAC through the
 * service, and appends the durable reference event only after the store call
 * commits — the lineage-bridge invariant checks exactly those events against
 * the store (platform-lineage-bridge §5).
 * @module @deepseek-ai/dsh-experimental-platform-shell/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import { PlatformShellError } from './error.ts'
import type { PlatformShellService } from './service.ts'
import type { ApprovalTicket, AssetId, AuditEvent, CapabilityId, CapabilityRecord, PresetValidationReport, ReviewScope, ScenarioId, TicketId, UserId, WorkspaceId } from './types.ts'
import { RoleId, WorkspaceId as brandWorkspaceId } from './types.ts'

/** The closed role set the seeded platform ships (identity seed roles). */
const KNOWN_ROLES = ['product', 'dev', 'qa', 'platform-admin'] as const

/** The closed asset-kind set of the store (asset-schema §2). */
const ASSET_KINDS = ['requirement', 'design', 'code', 'test-case', 'handoff'] as const

/** The approval state machine's statuses (approval-state-machine §2). */
const APPROVAL_STATUSES = ['draft', 'review', 'approved', 'rejected', 'released'] as const

/** The closed execution-depth set a capability may carry (architecture D4). */
const EXECUTION_MODES = ['managed', 'sandboxed', 'none'] as const

/** Resolve the platform user acting on behalf of one session. */
export type ResolveActor = (session: Session) => UserId

/**
 * Resolve a role preset's base rows from the roster. The host reads the roster
 * preset (never the platform-shell seam) and parses it with the entry-list
 * schema; the assembler then appends the selected capabilities' rows.
 */
export type ResolveBaseRows = (rolePreset: string, session: Session) => Promise<EntryOptions[]>

/** Model-facing ticket record; the review scope projects into lossless JSON. */
const ticketSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    workspaceId: { type: 'string', required: true },
    subjectKind: { type: 'string', required: true },
    subjectId: { type: 'string', required: true },
    status: { type: 'string', required: true },
    actorUserId: { type: 'string', required: true },
    reviewScope: { type: 'json', required: true },
    createdAt: { type: 'number', required: true },
    updatedAt: { type: 'number', required: true },
  },
} satisfies ValueSchemaSpec

/** Model-facing lineage edge. */
const edgeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assetId: { type: 'string', required: true },
    parentId: { type: 'string', required: true },
    roleId: { type: 'string', required: true },
    createdAt: { type: 'number', required: true },
  },
} satisfies ValueSchemaSpec

/** Model-facing market catalog entry. */
const capabilitySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    roleId: { type: 'string', required: true },
    execution: { type: 'string', required: true },
    version: { type: 'string', required: true },
    enabled: { type: 'boolean', required: true },
    rollout: { type: 'number', required: true },
    rate: { type: 'number', required: true },
    description: { type: 'string', required: true },
    tools: { type: 'array', required: true, items: { type: 'string' } },
    rows: { type: 'array', required: true, items: { type: 'json' } },
    createdAt: { type: 'number', required: true },
  },
} satisfies ValueSchemaSpec

/** Project a durable capability record into the mutable JSON the schema declares. */
function toCapabilityJson(capability: CapabilityRecord): {
  id: string
  name: string
  roleId: string
  execution: string
  version: string
  enabled: boolean
  rollout: number
  rate: number
  description: string
  tools: string[]
  rows: JsonValue[]
  createdAt: number
} {
  return { ...capability, tools: [...capability.tools], rows: rowsToJson(capability.rows) }
}

/**
 * Project one preset-tree row list into the model-facing JSON items. Rows are
 * plain JSON (id/name/config/disabled), so the projection is type-only — the
 * JSON-schema `items: { type: 'json' }` items cannot name the EntryOptions type.
 * @param rows - the preset-tree rows to project.
 * @returns the same values typed as JSON items.
 */
function rowsToJson(rows: readonly EntryOptions[]): JsonValue[] {
  return rows as unknown as JsonValue[]
}

/**
 * Project one validation report into the model-facing shape: the readonly
 * conflict lists become mutable JSON arrays for the output schema.
 * @param report - the assembler's validation report.
 * @returns the model-visible report.
 */
function projectReport(report: PresetValidationReport): {
  rowIdConflicts: string[]
  toolNameConflicts: string[]
  disabledOnPlatform: string[]
} {
  return {
    rowIdConflicts: [...report.rowIdConflicts],
    toolNameConflicts: [...report.toolNameConflicts],
    disabledOnPlatform: [...report.disabledOnPlatform],
  }
}

/** Model-facing scenario bundle (one pluggable C-side workbench surface). */
const scenarioSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    workbenchId: { type: 'string', required: true },
    roleId: { type: 'string', required: true },
    preset: { type: 'string', required: true },
    capabilityIds: { type: 'array', required: true, items: { type: 'string' } },
    createdAt: { type: 'number', required: true },
  },
} satisfies ValueSchemaSpec

/** Model-facing metered usage record. */
const usageSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    workspaceId: { type: 'string', required: true },
    capabilityId: { type: 'string', required: true },
    qty: { type: 'number', required: true },
    cost: { type: 'number', required: true },
    billedAt: { type: 'number', required: true },
    createdAt: { type: 'number', required: true },
  },
} satisfies ValueSchemaSpec

/** Model-facing settlement; `settledAt` stays JSON (null while open). */
const settlementSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    workspaceId: { type: 'string', required: true },
    period: { type: 'string', required: true },
    amount: { type: 'number', required: true },
    status: { type: 'string', required: true },
    createdAt: { type: 'number', required: true },
    settledAt: { type: 'json', required: true },
  },
} satisfies ValueSchemaSpec

/**
 * The calling agent's session and its bound platform actor.
 * @param exec - the tool execution carrying the calling agent.
 * @param resolveActor - session-to-actor resolver supplied at registration.
 * @returns the bound actor and the session to log reference events against.
 * @throws PlatformShellError (code `UNKNOWN_ACTOR`) when the call has no agent session.
 */
function boundCall(exec: ToolRunContext, resolveActor: ResolveActor): { actor: UserId; session: Session } {
  const agent = exec.agent
  if (agent === undefined) {
    throw new PlatformShellError('UNKNOWN_ACTOR', 'platform tools require an agent session')
  }
  const session = agent.session
  return { actor: resolveActor(session), session }
}

/**
 * Register the platform-shell model-facing tools on a context. The caller (the
 * host composition) supplies the session→user binding; every tool enforces
 * RBAC through `ctx.platformShell` and appends its reference event after the
 * store commit. Tool outputs carry `presentationMeta` so the persisted
 * `tool/result.meta` records the platform outcome — the model-visible ⟺ logged
 * proof — alongside the appended reference events.
 * @param ctx - context with the mounted `platformShell` service and `tools` registry.
 * @param options - actor binding for the deployment's sessions, plus the optional
 * roster base-row resolver the `assemble_preset` tool requires (calling that
 * tool without it fails loudly).
 * @returns the registered tool names.
 */
export function registerPlatformShellTools(
  ctx: Context,
  options: { readonly resolveActor: ResolveActor; readonly resolveBaseRows?: ResolveBaseRows },
): readonly string[] {
  const { resolveActor, resolveBaseRows } = options
  const shell = (): PlatformShellService => ctx.platformShell

  const definitions = [
    defineTool({
      name: 'register_asset',
      description: 'Record a produced artifact as a platform asset in a workspace, under the calling user\'s produce role. Returns the assigned asset id.',
      parameters: {
        workspaceId: { type: 'string', required: true, description: 'the workspace the asset belongs to' },
        kind: { type: 'string', required: true, enum: [...ASSET_KINDS], description: 'requirement | design | code | test-case | handoff' },
        content: { type: 'string', required: true, description: 'AI-readable projection of the artifact' },
        roleId: { type: 'string', required: true, enum: [...KNOWN_ROLES], description: 'the producing role' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            asset: {
              type: 'object',
              required: true,
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                content: { type: 'string', required: true },
                roleId: { type: 'string', required: true },
                workspaceId: { type: 'string', required: true },
                createdAt: { type: 'number', required: true },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `registered ${value.asset.kind} ${value.asset.id} (${value.asset.roleId}) in ${value.asset.workspaceId}` }],
        presentationMeta: (_args, value) => ({ code: 'registered', assetId: value.asset.id }),
      },
      execute(args, exec) {
        const { actor, session } = boundCall(exec, resolveActor)
        const asset = shell().registerAsset(actor, {
          workspaceId: brandWorkspaceId(args.workspaceId),
          kind: args.kind,
          content: args.content,
          roleId: RoleId(args.roleId),
        })
        session.append('asset/register', {
          assetId: asset.id,
          kind: asset.kind,
          roleId: asset.roleId,
          workspaceId: asset.workspaceId,
        })
        return Promise.resolve({ asset })
      },
    }),
    defineTool({
      name: 'get_asset',
      description: 'Read one platform asset by id; the caller must be a member of the asset\'s workspace.',
      parameters: {
        assetId: { type: 'string', required: true, description: 'asset id, e.g. requirement-1' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', required: true },
            asset: {
              type: 'object',
              required: true,
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                content: { type: 'string', required: true },
                roleId: { type: 'string', required: true },
                workspaceId: { type: 'string', required: true },
                createdAt: { type: 'number', required: true },
              },
            },
          },
        },
        render: (args, value) => [
          {
            type: 'text',
            text: value.found
              ? `asset ${value.asset.id} [${value.asset.kind}] by ${value.asset.roleId}: ${value.asset.content}`
              : `no asset ${args.assetId} visible to this user`,
          },
        ],
        presentationMeta: (_args, value) => ({ code: value.found ? 'read' : 'not-found' }),
      },
      execute(args, exec) {
        const { actor, session } = boundCall(exec, resolveActor)
        try {
          // The service reports a miss as ASSET_NOT_FOUND (handled below) rather
          // than returning undefined, so the typed `| undefined` cannot occur here.
          // oxlint-disable-next-line typescript/no-non-null-assertion
          const asset = shell().getAsset(actor, assetIdOf(args.assetId))!
          session.append('asset/read', {
            assetId: asset.id,
            kind: asset.kind,
            roleId: asset.roleId,
            workspaceId: asset.workspaceId,
          })
          return Promise.resolve({ found: true, asset })
        } catch (error) {
          // A NOT-FOUND result must not leak whether the asset exists in another
          // workspace: the placeholder is identical either way. Every other
          // platform error (e.g. PERMISSION_DENIED) propagates unchanged.
          if ((error as PlatformShellError).code === 'ASSET_NOT_FOUND') {
            return Promise.resolve({ found: false, asset: notFoundAsset(args.assetId) })
          }
          throw error
        }
      },
    }),
    defineTool({
      name: 'approve_ticket',
      description: 'Advance one business approval ticket across an allowed state-machine edge (draft→review→approved→released, rejected→draft). Transitioning to approved requires a review scope.',
      parameters: {
        ticketId: { type: 'string', required: true, description: 'ticket id, e.g. approval-1' },
        to: { type: 'string', required: true, enum: [...APPROVAL_STATUSES], description: 'the target status' },
        roles: {
          type: 'array',
          items: { type: 'string' },
          description: 'roles granted the review scope; required to transition to approved',
        },
        expiresAt: {
          type: 'number',
          description: 'epoch-ms expiry of the review scope; required to transition to approved',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ticket: { ...ticketSchema, required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `ticket ${value.ticket.id} is now ${value.ticket.status}` }],
        presentationMeta: (_args, value) => ({ code: 'transitioned', status: value.ticket.status }),
      },
      execute(args, exec) {
        const { actor, session } = boundCall(exec, resolveActor)
        const ticketId = ticketIdOf(args.ticketId)
        // The service reports an absent ticket as TICKET_NOT_FOUND rather than
        // returning undefined, so the typed `| undefined` cannot occur here.
        // oxlint-disable-next-line typescript/no-non-null-assertion
        const before = shell().getTicket(actor, ticketId)!
        const updated = shell().transition(actor, ticketId, args.to, buildScope(args, before.workspaceId))
        session.append('platform/approval/transition', {
          ticketId: updated.id,
          // `to` is the committed status read off the returned ticket and `from`
          // off the pre-transition ticket, so the durable event matches what the
          // store committed (the invariant validates exactly this).
          from: before.status,
          to: updated.status,
          actorUserId: actor,
          workspaceId: updated.workspaceId,
        })
        return Promise.resolve({ ticket: projectTicket(updated) })
      },
    }),
    defineTool({
      name: 'audit_query',
      description: 'List the workspace audit trail, optionally filtered by action.',
      parameters: {
        workspaceId: { type: 'string', description: 'workspace to audit; defaults to the caller\'s workspace' },
        action: { type: 'string', description: 'filter by audit action, e.g. asset.register' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            events: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  actorUserId: { type: 'string', required: true },
                  workspaceId: { type: 'string', required: true },
                  action: { type: 'string', required: true },
                  targetKind: { type: 'string', required: true },
                  targetId: { type: 'string', required: true },
                  createdAt: { type: 'number', required: true },
                },
              },
            },
          },
        },
        render: (args, value) => [{ type: 'text', text: `${value.events.length} audit events (${args.action ?? 'any action'})` }],
        presentationMeta: (_args, value) => ({ code: 'queried', count: value.events.length }),
      },
      execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        const events = shell().listAudit(actor, {
          ...args.workspaceId !== undefined ? { workspaceId: brandWorkspaceId(args.workspaceId) } : {},
          ...args.action !== undefined ? { action: args.action } : {},
        })
        return Promise.resolve({ events: events.map(projectAuditEvent) })
      },
    }),
    defineTool({
      name: 'submit_ticket',
      description: 'Submit one asset for business approval, creating a ticket in the draft state.',
      parameters: {
        workspaceId: { type: 'string', required: true, description: 'the workspace the subject asset belongs to' },
        subjectAssetId: { type: 'string', required: true, description: 'the asset id under approval' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ticket: { ...ticketSchema, required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `submitted ${value.ticket.id} for ${value.ticket.subjectKind} ${value.ticket.subjectId} (${value.ticket.status})` }],
        presentationMeta: (_args, value) => ({ code: 'submitted', ticketId: value.ticket.id, status: value.ticket.status }),
      },
      execute(args, exec) {
        const { actor, session } = boundCall(exec, resolveActor)
        const workspaceId = brandWorkspaceId(args.workspaceId)
        const ticket = shell().submitTicket(actor, workspaceId, assetIdOf(args.subjectAssetId))
        session.append('platform/approval/transition', {
          ticketId: ticket.id,
          from: null,
          to: ticket.status,
          actorUserId: actor,
          workspaceId,
        })
        return Promise.resolve({ ticket: projectTicket(ticket) })
      },
    }),
    defineTool({
      name: 'link_asset',
      description: 'Record that one asset derives from another asset in the same workspace, forming the lineage chain.',
      parameters: {
        assetId: { type: 'string', required: true, description: 'the derived asset id' },
        parentId: { type: 'string', required: true, description: 'the source asset id it derives from' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
          },
        },
        render: () => [{ type: 'text', text: 'lineage linked' }],
        presentationMeta: () => ({ code: 'linked' }),
      },
      execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        shell().linkAsset(actor, assetIdOf(args.assetId), assetIdOf(args.parentId))
        return Promise.resolve({ ok: true })
      },
    }),
    defineTool({
      name: 'get_ticket',
      description: 'Read one approval ticket by id.',
      parameters: {
        ticketId: { type: 'string', required: true, description: 'ticket id, e.g. approval-1' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ticket: { ...ticketSchema, required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `${value.ticket.id} [${value.ticket.status}] for ${value.ticket.subjectKind} ${value.ticket.subjectId}` }],
        presentationMeta: (_args, value) => ({ code: 'read', ticketId: value.ticket.id, status: value.ticket.status }),
      },
      execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        // The service reports an absent ticket as TICKET_NOT_FOUND rather than
        // returning undefined.
        // oxlint-disable-next-line typescript/no-non-null-assertion
        const ticket = shell().getTicket(actor, ticketIdOf(args.ticketId))!
        return Promise.resolve({ ticket: projectTicket(ticket) })
      },
    }),
    defineTool({
      name: 'list_tickets',
      description: 'List every approval ticket in one workspace.',
      parameters: {
        workspaceId: { type: 'string', required: true, description: 'the workspace whose tickets to list' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tickets: { type: 'array', required: true, items: ticketSchema },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.tickets.map(t => `${t.id}: ${t.subjectKind} ${t.subjectId} [${t.status}]`).join(', ') || 'no tickets' }],
        presentationMeta: (_args, value) => ({ code: 'listed', count: value.tickets.length }),
      },
      execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        return Promise.resolve({ tickets: shell().listTickets(actor, brandWorkspaceId(args.workspaceId)).map(projectTicket) })
      },
    }),
    defineTool({
      name: 'asset_ancestors',
      description: 'List every transitive derivation source of one asset, from its immediate parent toward the origin.',
      parameters: {
        assetId: { type: 'string', required: true, description: 'asset id whose ancestry to trace' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            edges: { type: 'array', required: true, items: edgeSchema },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.edges.map(e => `${e.assetId} <- ${e.parentId}`).join(', ') || 'no ancestors' }],
        presentationMeta: (_args, value) => ({ code: 'traced', count: value.edges.length }),
      },
      execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        return Promise.resolve({ edges: shell().ancestors(actor, assetIdOf(args.assetId)) })
      },
    }),
    defineTool({
      name: 'asset_descendants',
      description: 'List every transitive derivation child of one asset, from its immediate children toward the leaves.',
      parameters: {
        assetId: { type: 'string', required: true, description: 'asset id whose descendants to trace' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            edges: { type: 'array', required: true, items: edgeSchema },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.edges.map(e => `${e.parentId} -> ${e.assetId}`).join(', ') || 'no descendants' }],
        presentationMeta: (_args, value) => ({ code: 'traced', count: value.edges.length }),
      },
      execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        return Promise.resolve({ edges: shell().descendants(actor, assetIdOf(args.assetId)) })
      },
    }),
    defineTool({
      name: 'publish_capability',
      description: 'Publish one capability to the market catalog, with dependency and conflict edges, an execution depth, a graded version, a per-unit credit rate, and a gray-release gate.',
      parameters: {
        id: { type: 'string', required: true, description: 'catalog id (a slug the operator chooses), e.g. requirement-management' },
        name: { type: 'string', required: true, description: 'display name of the capability' },
        roleId: { type: 'string', required: true, enum: [...KNOWN_ROLES], description: 'the role the capability serves' },
        execution: { type: 'string', required: true, enum: [...EXECUTION_MODES], description: 'managed | sandboxed | none' },
        version: { type: 'string', required: true, description: 'graded semver-like version, e.g. 1.2.0' },
        rate: { type: 'number', required: true, description: 'credits charged per unit consumed' },
        dependencies: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true, description: 'required capability id' },
              range: { type: 'string', description: 'required version range, e.g. >=1.0.0' },
            },
          },
          description: 'capabilities this capability requires, resolved transitively',
        },
        conflictsWith: { type: 'array', items: { type: 'string' }, description: 'capabilities that must not co-occur in one selection' },
        tools: { type: 'array', items: { type: 'string' }, description: 'tool names whose execution this capability\'s gate governs' },
        enabled: { type: 'boolean', description: 'execution gate; defaults to enabled' },
        rollout: { type: 'number', description: 'gray-release fraction 0..1 of workspaces allowed; defaults to 1' },
        description: { type: 'string', description: 'capability description' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            capability: { ...capabilitySchema, required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `published ${value.capability.id} v${value.capability.version} (${value.capability.execution}, ${value.capability.rate} credits/unit)` }],
        presentationMeta: (_args, value) => ({ code: 'published', capabilityId: value.capability.id, version: value.capability.version }),
      },
      execute(args, exec) {
        const { actor, session } = boundCall(exec, resolveActor)
        const capability = shell().publishCapability(actor, {
          id: capabilityIdOf(args.id),
          name: args.name,
          roleId: RoleId(args.roleId),
          execution: args.execution,
          version: args.version,
          rate: args.rate,
          ...(args.dependencies !== undefined ? { dependencies: args.dependencies.map(buildDependency) } : {}),
          ...(args.conflictsWith !== undefined ? { conflictsWith: args.conflictsWith.map(capabilityIdOf) } : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
          ...(args.rollout !== undefined ? { rollout: args.rollout } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.tools !== undefined ? { tools: args.tools } : {}),
        })
        session.append('capability/published', {
          capabilityId: capability.id,
          version: capability.version,
          roleId: capability.roleId,
        })
        return Promise.resolve({ capability: toCapabilityJson(capability) })
      },
    }),
    defineTool({
      name: 'list_capabilities',
      description: 'List every capability in the market catalog.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            capabilities: { type: 'array', required: true, items: capabilitySchema },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.capabilities.map(c => `${c.id} v${c.version} [${c.execution}]`).join(', ') || 'no capabilities' }],
        presentationMeta: (_args, value) => ({ code: 'listed', count: value.capabilities.length }),
      },
      execute(_args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        return Promise.resolve({ capabilities: shell().listCapabilities(actor).map(toCapabilityJson) })
      },
    }),
    defineTool({
      name: 'assemble_capabilities',
      description: 'Resolve one capability selection for a workspace within a scenario workbench: auto-resolves transitive dependencies, rejects conflicts and version-range mismatches, and refuses gated-off capabilities.',
      parameters: {
        workspaceId: { type: 'string', required: true, description: 'the workspace assembling capabilities' },
        scenarioId: { type: 'string', required: true, description: 'the scenario bundle (workbench) to assemble against' },
        selected: { type: 'array', required: true, items: { type: 'string' }, description: 'the capability ids the user picked from the workbench' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            requested: { type: 'array', required: true, items: { type: 'string' } },
            resolved: { type: 'array', required: true, items: capabilitySchema },
            preset: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `resolved ${value.requested.length} requested into ${value.resolved.length} capabilities under preset ${value.preset}` }],
        presentationMeta: (_args, value) => ({ code: 'resolved', count: value.resolved.length, preset: value.preset }),
      },
      execute(args, exec) {
        const { actor, session } = boundCall(exec, resolveActor)
        const workspaceId = brandWorkspaceId(args.workspaceId)
        const resolved = shell().resolveCapabilities(actor, {
          workspaceId,
          scenarioId: scenarioIdOf(args.scenarioId),
          selected: args.selected.map(capabilityIdOf),
        })
        session.append('capability/selected', {
          workspaceId,
          capabilityIds: resolved.requested,
          preset: resolved.preset,
        })
        // The output schema's items are plain JSON, so the durable readonly
        // sets project into mutable arrays.
        return Promise.resolve({
          requested: [...resolved.requested],
          resolved: resolved.resolved.map(toCapabilityJson),
          preset: resolved.preset,
        })
      },
    }),
    defineTool({
      name: 'assemble_preset',
      description: 'Render and validate one workbench preset tree for commit: appends each selected capability\'s preset rows to the role preset\'s base rows in catalog order and statically validates the result. Rejects duplicate row ids and shadowed tool names; reports rows disabled for the current platform. The host commits the returned rows to the roster.',
      parameters: {
        workspaceId: { type: 'string', required: true, description: 'the workspace assembling the workbench' },
        scenarioId: { type: 'string', required: true, description: 'the scenario bundle (workbench) to assemble against' },
        roleId: { type: 'string', required: true, enum: [...KNOWN_ROLES], description: 'the role the workbench serves' },
        rolePreset: { type: 'string', required: true, description: 'the roster preset id whose base rows seed the tree' },
        preset: { type: 'string', required: true, description: 'the roster preset id the rendered tree is destined for' },
        selected: { type: 'array', required: true, items: { type: 'string' }, description: 'the capability ids the user picked from the workbench' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            preset: { type: 'string', required: true },
            roleId: { type: 'string', required: true },
            scenarioId: { type: 'string', required: true },
            resolved: { type: 'array', required: true, items: capabilitySchema },
            rows: { type: 'array', required: true, items: { type: 'json' } },
            report: {
              type: 'object',
              required: true,
              additionalProperties: false,
              properties: {
                rowIdConflicts: { type: 'array', required: true, items: { type: 'string' } },
                toolNameConflicts: { type: 'array', required: true, items: { type: 'string' } },
                disabledOnPlatform: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `assembled preset ${value.preset} with ${value.rows.length} rows across ${value.resolved.length} capabilities (${value.report.disabledOnPlatform.length} disabled on this platform)` }],
        presentationMeta: (_args, value) => ({ code: 'assembled', preset: value.preset, rows: value.rows.length, disabled: value.report.disabledOnPlatform.length }),
      },
      async execute(args, exec) {
        const { actor, session } = boundCall(exec, resolveActor)
        if (resolveBaseRows === undefined) {
          throw new PlatformShellError('INVALID_ARGUMENT', 'assemble_preset requires a resolveBaseRows binding')
        }
        const workspaceId = brandWorkspaceId(args.workspaceId)
        const scenarioId = scenarioIdOf(args.scenarioId)
        const roleId = RoleId(args.roleId)
        const base = await resolveBaseRows(args.rolePreset, session)
        const assembled = shell().assemblePreset(actor, {
          workspaceId,
          scenarioId,
          roleId,
          rolePreset: args.rolePreset,
          base,
          selected: args.selected.map(capabilityIdOf),
          preset: args.preset,
        })
        session.append('preset/assembled', {
          workspaceId,
          scenarioId,
          roleId,
          preset: assembled.preset,
          capabilityIds: assembled.resolved.map(c => c.id),
          rows: assembled.rows,
        })
        return {
          preset: assembled.preset,
          roleId,
          scenarioId,
          resolved: assembled.resolved.map(toCapabilityJson),
          rows: rowsToJson(assembled.rows),
          report: projectReport(assembled.report),
        }
      },
    }),
    defineTool({
      name: 'set_capability_gate',
      description: 'Set one capability\'s execution gate: enable or disable it and choose the 0..1 gray-release rollout fraction of workspaces allowed to use it.',
      parameters: {
        capabilityId: { type: 'string', required: true, description: 'catalog id to gate' },
        enabled: { type: 'boolean', required: true, description: 'whether the capability is usable at all' },
        rollout: { type: 'number', required: true, description: 'fraction 0..1 of workspaces the rollout admits' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            capability: { ...capabilitySchema, required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `${value.capability.id} gate: ${value.capability.enabled ? 'enabled' : 'disabled'} at rollout ${value.capability.rollout}` }],
        presentationMeta: (_args, value) => ({ code: 'gated', capabilityId: value.capability.id, enabled: value.capability.enabled, rollout: value.capability.rollout }),
      },
      execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        const capability = shell().setCapabilityGate(
          actor,
          capabilityIdOf(args.capabilityId),
          { enabled: args.enabled, rollout: args.rollout },
        )
        return Promise.resolve({ capability: toCapabilityJson(capability) })
      },
    }),
    defineTool({
      name: 'publish_scenario',
      description: 'Register one scenario bundle: a pluggable C-side workbench surface (its workbench id, role, preset binding, and capability set) for a customer group.',
      parameters: {
        id: { type: 'string', required: true, description: 'scenario id, e.g. product-engineering' },
        name: { type: 'string', required: true, description: 'display name of the workbench' },
        workbenchId: { type: 'string', required: true, description: 'the customer-group workbench surface, e.g. product-engineering' },
        roleId: { type: 'string', required: true, enum: [...KNOWN_ROLES], description: 'the role the workbench serves' },
        preset: { type: 'string', required: true, description: 'the agent preset id the roster mounts for this workbench' },
        capabilityIds: { type: 'array', required: true, items: { type: 'string' }, description: 'the capability set this workbench offers' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scenario: { ...scenarioSchema, required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `published workbench ${value.scenario.workbenchId} (${value.scenario.preset}) with ${value.scenario.capabilityIds.length} capabilities` }],
        presentationMeta: (_args, value) => ({ code: 'published', scenarioId: value.scenario.id, workbenchId: value.scenario.workbenchId }),
      },
      execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        const scenario = shell().publishScenario(actor, {
          id: scenarioIdOf(args.id),
          name: args.name,
          workbenchId: args.workbenchId,
          roleId: RoleId(args.roleId),
          preset: args.preset,
          capabilityIds: args.capabilityIds.map(capabilityIdOf),
        })
        // The output schema's capabilityIds are plain JSON strings.
        return Promise.resolve({ scenario: { ...scenario, capabilityIds: [...scenario.capabilityIds] } })
      },
    }),
    defineTool({
      name: 'list_scenarios',
      description: 'List every scenario bundle (C-side workbench surface) in the market.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scenarios: { type: 'array', required: true, items: scenarioSchema },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.scenarios.map(s => `${s.workbenchId}: ${s.name} [${s.capabilityIds.length} capabilities]`).join(', ') || 'no scenarios' }],
        presentationMeta: (_args, value) => ({ code: 'listed', count: value.scenarios.length }),
      },
      execute(_args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        return Promise.resolve({
          scenarios: shell().listScenarios(actor).map(scenario => ({ ...scenario, capabilityIds: [...scenario.capabilityIds] })),
        })
      },
    }),
    defineTool({
      name: 'consume_capability',
      description: 'Meter one capability consumption against a workspace account: debits credits at the capability\'s rate, records usage, and accrues the open settlement.',
      parameters: {
        workspaceId: { type: 'string', required: true, description: 'the workspace whose account is charged' },
        capabilityId: { type: 'string', required: true, description: 'the capability to consume' },
        qty: { type: 'number', description: 'quantity to consume; defaults to 1' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            usage: { ...usageSchema, required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `metered ${value.usage.qty} x ${value.usage.capabilityId} for ${value.usage.cost} credits` }],
        presentationMeta: (_args, value) => ({ code: 'metered', usageId: value.usage.id, cost: value.usage.cost }),
      },
      execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        const usage = shell().consumeCapability(actor, {
          workspaceId: brandWorkspaceId(args.workspaceId),
          capabilityId: capabilityIdOf(args.capabilityId),
          ...(args.qty !== undefined ? { qty: args.qty } : {}),
        })
        return Promise.resolve({ usage })
      },
    }),
    defineTool({
      name: 'account_balance',
      description: 'Read one workspace\'s billing account balance in credits.',
      parameters: {
        workspaceId: { type: 'string', required: true, description: 'the workspace whose account to read' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', required: true },
            account: {
              type: 'object',
              required: true,
              additionalProperties: false,
              properties: {
                workspaceId: { type: 'string', required: true },
                balance: { type: 'number', required: true },
                createdAt: { type: 'number', required: true },
              },
            },
          },
        },
        render: (args, value) => [{ type: 'text', text: value.found ? `workspace ${value.account.workspaceId} holds ${value.account.balance} credits` : `no account opened for ${args.workspaceId}` }],
        presentationMeta: (_args, value) => ({ code: value.found ? 'read' : 'not-found' }),
      },
      execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        const workspaceId = brandWorkspaceId(args.workspaceId)
        const account = shell().accountBalance(actor, workspaceId)
        return Promise.resolve({ found: account !== undefined, account: account ?? { workspaceId, balance: 0, createdAt: 0 } })
      },
    }),
    defineTool({
      name: 'settle_account',
      description: 'Close one workspace\'s open settlement for a billing period, flipping it from open to settled.',
      parameters: {
        workspaceId: { type: 'string', required: true, description: 'the workspace whose period to settle' },
        period: { type: 'string', required: true, description: 'the YYYY-MM billing period to close' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            settlement: { ...settlementSchema, required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `settlement ${value.settlement.id} closed ${value.settlement.period} at ${value.settlement.amount} credits (${value.settlement.status})` }],
        presentationMeta: (_args, value) => ({ code: 'settled', settlementId: value.settlement.id, amount: value.settlement.amount }),
      },
      execute(args, exec) {
        const { actor, session } = boundCall(exec, resolveActor)
        const settlement = shell().settleAccount(actor, brandWorkspaceId(args.workspaceId), args.period)
        session.append('billing/settlement', {
          settlementId: settlement.id,
          workspaceId: settlement.workspaceId,
          period: settlement.period,
          status: settlement.status,
        })
        return Promise.resolve({ settlement })
      },
    }),
  ]
  for (const definition of definitions) ctx.tools.register(definition)
  return definitions.map(definition => definition.name)
}

/**
 * Brand one tool-provided asset id string.
 * @param id - validated asset identity string.
 * @returns the id branded as an AssetId.
 */
function assetIdOf(id: string): AssetId {
  return id as AssetId
}

/**
 * Brand one tool-provided ticket id string.
 * @param id - validated ticket identity string.
 * @returns the id branded as a TicketId.
 */
function ticketIdOf(id: string): TicketId {
  return id as TicketId
}

/**
 * Brand one tool-provided capability id string.
 * @param id - validated capability identity string.
 * @returns the id branded as a CapabilityId.
 */
function capabilityIdOf(id: string): CapabilityId {
  return id as CapabilityId
}

/**
 * Brand one tool-provided scenario id string.
 * @param id - validated scenario identity string.
 * @returns the id branded as a ScenarioId.
 */
function scenarioIdOf(id: string): ScenarioId {
  return id as ScenarioId
}

/**
 * Build one durable dependency edge from validated tool args.
 * @param dependency - the validated dependency object.
 * @returns the edge branded for the catalog, keeping the optional version range.
 */
function buildDependency(
  dependency: { readonly id: string; readonly range?: string },
): { readonly id: CapabilityId; readonly range?: string } {
  return dependency.range === undefined
    ? { id: capabilityIdOf(dependency.id) }
    : { id: capabilityIdOf(dependency.id), range: dependency.range }
}

/**
 * Build the review scope granted by a transition, from the optional tool args.
 * @param args - the validated approve_ticket arguments.
 * @param workspaceId - the workspace the ticket belongs to.
 * @returns the review scope, or `undefined` when the call grants none.
 */
function buildScope(
  args: { readonly roles?: readonly string[]; readonly expiresAt?: number },
  workspaceId: WorkspaceId,
): ReviewScope | undefined {
  if (args.roles === undefined || args.expiresAt === undefined) return undefined
  return { roles: args.roles.map(roleId => RoleId(roleId)), workspace: workspaceId, expiresAt: args.expiresAt }
}

/**
 * The non-leaking NOT-FOUND asset projection: identical whether the asset is
 * missing outright or belongs to a workspace the caller cannot read.
 * @param id - the requested asset id.
 * @returns the model-visible placeholder.
 */
function notFoundAsset(id: string): { id: string; kind: string; content: string; roleId: string; workspaceId: string; createdAt: number } {
  return { id, kind: 'unknown', content: 'not found', roleId: 'unknown', workspaceId: brandWorkspaceId(''), createdAt: 0 }
}

/**
 * Project one durable ticket into the model-facing shape: the review scope
 * becomes lossless JSON so the output schema's `additionalProperties: false`
 * accepts the value (the store's `ReviewScope` carries readonly branded roles).
 * @param ticket - the durable ticket.
 * @returns the model-visible projection.
 */
function projectTicket(ticket: ApprovalTicket): {
  id: string
  workspaceId: string
  subjectKind: string
  subjectId: string
  status: string
  actorUserId: string
  reviewScope: JsonValue
  createdAt: number
  updatedAt: number
} {
  return {
    id: ticket.id,
    workspaceId: ticket.workspaceId,
    subjectKind: ticket.subjectKind,
    subjectId: ticket.subjectId,
    status: ticket.status,
    actorUserId: ticket.actorUserId,
    reviewScope: ticket.reviewScope === null
      ? null
      : {
        roles: [...ticket.reviewScope.roles],
        workspace: ticket.reviewScope.workspace,
        expiresAt: ticket.reviewScope.expiresAt,
      },
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  }
}

/**
 * Project one audit row into the model-facing shape.
 * @param event - the durable audit event.
 * @returns the model-visible projection.
 */
function projectAuditEvent(event: AuditEvent): {
  id: string
  actorUserId: string
  workspaceId: string
  action: string
  targetKind: string
  targetId: string
  createdAt: number
} {
  // The service's audit scope is always one workspace, so every returned row
  // carries non-null workspace and target fields; the store's nullability only
  // covers tenant-level rows the service never exposes.
  return {
    id: event.id,
    actorUserId: event.actorUserId,
    workspaceId: event.workspaceId as string,
    action: event.action,
    targetKind: event.targetKind as string,
    targetId: event.targetId as string,
    createdAt: event.createdAt,
  }
}
