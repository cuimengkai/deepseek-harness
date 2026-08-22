import { describe, expect, it } from 'vitest'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { assertNoToolShadowing, renderPresetTree, validatePresetTree } from '../src/preset-assembler.ts'
import type { CapabilityRecord } from '../src/types.ts'
import { CapabilityId, RoleId } from '../src/types.ts'

/** A `!!js` disabled node gating one row to the given platform. */
function platformDisabled(platform: string): boolean {
  return { __jsExpr: `process.platform === '${platform}'` } as unknown as boolean
}

/** One minimal capability record carrying the given preset rows. */
function capability(id: string, rows: readonly EntryOptions[], tools: readonly string[] = []): CapabilityRecord {
  return {
    id: CapabilityId(id),
    name: id,
    roleId: RoleId('product'),
    execution: 'managed',
    version: '1.0.0',
    enabled: true,
    rollout: 1,
    rate: 1,
    description: id,
    tools,
    rows,
    createdAt: 1,
  }
}

/** One preset row the base or a capability contributes. */
function row(id: string, name = 'persona-row', extra: Partial<EntryOptions> = {}): EntryOptions {
  return { id, name, ...extra }
}

const base: readonly EntryOptions[] = [
  row('persona', '@deepseek-ai/dsh-persona', { config: { text: 'base persona' } }),
]

describe('renderPresetTree', () => {
  it('appends capability rows after the base in dependency-first order, detaching the result', () => {
    const resolved = [
      capability('c-planning', [row('c-planning', undefined, { config: { order: 10 } })]),
      capability('c-publishing', [row('c-publishing', undefined, { config: { order: 11 } })]),
    ]
    const rendered = renderPresetTree(base, resolved, undefined, () => {})
    expect(rendered.map(r => r.id)).toEqual(['persona', 'c-planning', 'c-publishing'])
    // The rendered tree detaches from the inputs: mutating it must not leak.
    rendered[0] = row('other')
    expect(base[0]?.id).toBe('persona')
  })

  it('applies id-targeted overlay patches over the combined tree', () => {
    const resolved = [capability('c', [row('c')])]
    const patches: PatchOptions[] = [{ id: 'c', config: { order: 99, extra: true } }]
    const rendered = renderPresetTree(base, resolved, patches, () => {})
    expect(rendered.find(r => r.id === 'c')?.config).toMatchObject({ order: 99, extra: true })
  })

  it('warns once for a patch whose target id is absent, and keeps the tree', () => {
    const warnings: string[] = []
    const rendered = renderPresetTree(base, [], [{ id: 'missing' }], message => warnings.push(message))
    expect(warnings.length).toBe(1)
    expect(rendered.map(r => r.id)).toEqual(['persona'])
  })

  it('keeps a `!!js` disabled node evaluable through a structured-clone + JSON round-trip', () => {
    const resolved = [capability('c', [
      row('c', undefined, { disabled: platformDisabled('darwin') }),
    ])]
    const rendered = renderPresetTree(base, resolved, undefined, () => {})
    const roundTripped = JSON.parse(JSON.stringify(structuredClone(rendered))) as EntryOptions[]
    const report = validatePresetTree(roundTripped, 'darwin')
    expect(report.disabledOnPlatform).toEqual(['c'])
  })
})

describe('validatePresetTree', () => {
  it('reports a row disabled for the current platform and not for another', () => {
    const rows = [row('desktop', undefined, { disabled: platformDisabled('darwin') })]
    expect(validatePresetTree(rows, 'darwin').disabledOnPlatform).toEqual(['desktop'])
    expect(validatePresetTree(rows, 'linux').disabledOnPlatform).toEqual([])
  })

  it('reports duplicate ids across the rendered tree, including base vs capability', () => {
    const rows = [
      ...base,
      row('persona', undefined, { config: { text: 'capability persona reuses the base id' } }),
      row('base-vs-cap', undefined, { config: {} }),
      row('base-vs-cap', undefined, { config: {} }),
    ]
    const report = validatePresetTree(rows, 'darwin')
    expect(report.rowIdConflicts).toEqual(['persona', 'base-vs-cap'])
    // The capability that reuses the base id is exactly the base-vs-capability
    // case the assembler rejects before a tree reaches the roster.
    expect(report.rowIdConflicts).toContain('persona')
  })

  it('ignores a duplicate from a nested group config, validating only top-level ids', () => {
    const rows = [
      row('outer'),
      row('nested', undefined, { group: true, config: [row('outer')] }),
    ]
    const report = validatePresetTree(rows, 'darwin')
    expect(report.rowIdConflicts).toEqual([])
  })
})

describe('assertNoToolShadowing', () => {
  it('returns the tool name a second capability owns', () => {
    const shadowed = assertNoToolShadowing([
      capability('publishing', [], ['content_export']),
      capability('review', [], ['content_export']),
    ])
    expect(shadowed).toEqual(['content_export'])
  })

  it('returns nothing for tools owned by one capability and unowned tools', () => {
    const shadowed = assertNoToolShadowing([
      capability('a', [], ['export']),
      capability('b', [], ['analyze']),
    ])
    expect(shadowed).toEqual([])
  })

  it('is deterministic across capabilities in first-seen order', () => {
    const reversed = assertNoToolShadowing([
      capability('b', [], ['content_export']),
      capability('a', [], ['content_export']),
      capability('c', [], ['content_export']),
    ])
    // One tool name, three owners: the shadow report is the single name once.
    expect(reversed).toEqual(['content_export'])
  })
})
