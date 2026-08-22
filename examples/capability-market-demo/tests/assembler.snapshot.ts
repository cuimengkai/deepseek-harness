/**
 * Keyless snapshot of the capability-market-demo `assembler` section.
 *
 * The demo is a real boot of the platform-shell assembly: it drives the market
 * operator and the content-marketing creator against the SQLite control-plane
 * store, commits the rendered preset to the roster, and mounts a fresh agent on
 * it. The `assembler` section is the machine-readable proof of the guided build
 * — the published capability rows, the rendered tree, the validation report,
 * the determinism check, the two loud rejections, and the mounted-surface
 * assertions. Volatile per-run workspace ids (`ws-<epochMs>-<seq>`) normalize
 * to a stable label so the section is a pure function of the drive. The mock
 * model adapter makes the run keyless: no `.env`, no network, no API quota.
 * @module capability-market-demo-assembler-snapshot
 */

import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const demoPath = fileURLToPath(new URL('../src/demo.ts', import.meta.url))
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const run = promisify(execFile)

/** Normalize the per-run volatile workspace ids to a stable label. */
function normalize(output: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(output).replace(/"ws-\d+-\d+"/g, '"ws-N"')) as Record<string, unknown>
}

describe('capability-market-demo assembler section', () => {
  it('renders the guided-build proofs deterministically (keyless)', async () => {
    const { stdout } = await run(
      process.execPath,
      ['--import', 'tsx/esm', demoPath],
      { cwd: repoRoot, encoding: 'utf8', timeout: 90_000 },
    )
    const output = normalize(JSON.parse(stdout) as Record<string, unknown>)
    expect(output.assembler).toMatchSnapshot()
  })
})
