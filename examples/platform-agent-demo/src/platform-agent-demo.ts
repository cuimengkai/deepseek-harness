import type { Plugin } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import PlatformService from './platform-service.ts'

export const name = 'platform-agent-demo'
export const inject = ['tools']

/**
 * The engine-adapter layer's ACL translation: record a role's sandbox mode as
 * the session override (`setSandboxMode` appends the `sandbox/mode` event, so
 * it is durable and replayable). The workspace boundary comes from the
 * session's creation `cwd` — the role's exclusive workspace root, supplied at
 * `createAgent` — which sandbox-policy resolves as the `workspace-write` root
 * on every confined call. The enforcing provider reads exactly this policy per
 * call, so the ACL holds at the provider boundary; the model never carries the
 * role→workspace map, only the resolved policy.
 */
export function applyRolePolicy(session: Session, mode: SandboxMode): void {
  setSandboxMode(session, mode)
}

export const apply: Plugin = (ctx) => {
  // The business-object store (control plane). In the real platform this is
  // the self-built business-object database; here it is the in-memory service.
  // Constructing the Service registers it as `ctx.platformService` and
  // unregisters it automatically when this fiber unloads.
  new PlatformService(ctx)

  ctx.tools.register(defineTool({
    name: 'register_asset',
    description: 'Record a produced artifact as a platform asset for cross-role traceability.',
    parameters: {
      kind: { type: 'string', required: true, description: 'requirement | design | code | test-case | handoff' },
      content: { type: 'string', required: true, description: 'AI-readable projection of the artifact' },
      role: { type: 'string', required: true, description: 'producing role: product | ui | dev | qa' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `registered asset ${value.id}` }],
    },
    async execute(args) {
      const id = ctx.platformService.registerAsset({
        kind: args.kind,
        content: args.content,
        role: args.role,
      })
      return { id }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_asset',
    description: 'Fetch a previously registered platform asset by id.',
    parameters: {
      id: { type: 'string', required: true, description: 'asset id, e.g. requirement-1' },
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
              role: { type: 'string', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `asset ${value.asset.id} [${value.asset.kind}] by ${value.asset.role}: ${value.asset.content}` }],
    },
    async execute(args) {
      const asset = ctx.platformService.getAsset(args.id)
      if (asset === undefined) return { asset: { id: args.id, kind: 'unknown', content: 'no asset found', role: 'unknown' } }
      return { asset }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'register_credential',
    description: 'Store a credential for a role in the platform credential store.',
    parameters: {
      name: { type: 'string', required: true, description: 'credential reference name, e.g. DEV_APP_TOKEN' },
      value: { type: 'string', required: true, description: 'the secret value' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.ok ? 'credential stored' : 'failed' }],
    },
    async execute(args) {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) return { ok: false }
      await credentials.set(credentialRef(args.name), args.value)
      return { ok: true }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'read_credential',
    description: 'Read a credential value from the platform credential store.',
    parameters: {
      name: { type: 'string', required: true, description: 'credential reference name, e.g. DEV_APP_TOKEN' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          configured: { type: 'boolean', required: true },
          value: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.configured ? `credential ${_args.name} resolved` : 'not configured' }],
    },
    async execute(args) {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) return { configured: false, value: '' }
      const resolved = await credentials.resolve(credentialRef(args.name))
      return resolved === undefined
        ? { configured: false, value: '' }
        : { configured: true, value: resolved.value }
    },
  }))
}
