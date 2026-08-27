import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defaultConcurrency } from './run-gates.ts'

/**
 * Script entry guards: the repo's script mains are gated by comparing
 * process.argv[1] with import.meta.filename (gen-tool-catalog's pattern), not
 * by import.meta.main, which first shipped in Node 24.5 while the package
 * engines range admits Node 24.0. Spawning one guarded script through the
 * source-launch vector and requiring its loud failure proves the entry arm
 * fires on the CURRENT Node; importing the module in-process (the first
 * assertion) proves the import arm stays inert, so a spec import never runs
 * the gates.
 */

const runGatesEntry = fileURLToPath(new URL('./run-gates.ts', import.meta.url))

describe('script entry guards', () => {
  it('imports the module without triggering its script main', () => {
    // The import at the top of this file already ran the guard with vitest's
    // own argv; a guard that fired would have executed every gate in the
    // default mode and failed the suite before reaching this assertion. The
    // pure-export probe below only gives the import something to observe.
    expect(defaultConcurrency('doc-sync', 8).workers).toBe(4)
  })

  it('runs the script main when the script is the entry point', () => {
    // An unknown mode makes main fail loudly instead of running gates; a
    // reverted import.meta.main guard exits 0 silently on Node 24.0-24.4.
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', runGatesEntry, 'not-a-mode'],
      { encoding: 'utf8', timeout: 60_000 },
    )
    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('run-gates: expected mode')
    expect(result.stderr).toContain('not-a-mode')
  })
})
