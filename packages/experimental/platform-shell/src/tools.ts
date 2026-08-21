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
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import { PlatformShellError } from './error.ts'
import type { PlatformShellService } from './service.ts'
import type { ApprovalTicket, AssetId, AuditEvent, ReviewScope, TicketId, UserId, WorkspaceId } from './types.ts'
import { RoleId, WorkspaceId as brandWorkspaceId } from './types.ts'

/** The closed role set the seeded platform ships (identity seed roles). */
const KNOWN_ROLES = ['product', 'dev', 'qa', 'platform-admin'] as const

/** The closed asset-kind set of the store (asset-schema §2). */
const ASSET_KINDS = ['requirement', 'design', 'code', 'test-case', 'handoff'] as const

/** The approval state machine's statuses (approval-state-machine §2). */
const APPROVAL_STATUSES = ['draft', 'review', 'approved', 'rejected', 'released'] as const

/** Resolve the platform user acting on behalf of one session. */
export type ResolveActor = (session: Session) => UserId

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
 * @param options - actor binding for the deployment's sessions.
 * @returns the registered tool names.
 */
export function registerPlatformShellTools(ctx: Context, options: { readonly resolveActor: ResolveActor }): readonly string[] {
  const { resolveActor } = options
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
      async execute(args, exec) {
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
        return { asset }
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
      async execute(args, exec) {
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
          return { found: true, asset }
        } catch (error) {
          // A NOT-FOUND result must not leak whether the asset exists in another
          // workspace: the placeholder is identical either way. Every other
          // platform error (e.g. PERMISSION_DENIED) propagates unchanged.
          if ((error as PlatformShellError).code === 'ASSET_NOT_FOUND') {
            return { found: false, asset: notFoundAsset(args.assetId) }
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
      async execute(args, exec) {
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
        return { ticket: projectTicket(updated) }
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
      async execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        const events = shell().listAudit(actor, {
          ...args.workspaceId !== undefined ? { workspaceId: brandWorkspaceId(args.workspaceId) } : {},
          ...args.action !== undefined ? { action: args.action } : {},
        })
        return { events: events.map(projectAuditEvent) }
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
      async execute(args, exec) {
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
        return { ticket: projectTicket(ticket) }
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
      async execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        shell().linkAsset(actor, assetIdOf(args.assetId), assetIdOf(args.parentId))
        return { ok: true }
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
      async execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        // The service reports an absent ticket as TICKET_NOT_FOUND rather than
        // returning undefined.
        // oxlint-disable-next-line typescript/no-non-null-assertion
        const ticket = shell().getTicket(actor, ticketIdOf(args.ticketId))!
        return { ticket: projectTicket(ticket) }
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
      async execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        return { tickets: shell().listTickets(actor, brandWorkspaceId(args.workspaceId)).map(projectTicket) }
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
      async execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        return { edges: shell().ancestors(actor, assetIdOf(args.assetId)) }
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
      async execute(args, exec) {
        const { actor } = boundCall(exec, resolveActor)
        return { edges: shell().descendants(actor, assetIdOf(args.assetId)) }
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
