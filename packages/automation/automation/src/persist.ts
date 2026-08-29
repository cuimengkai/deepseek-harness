/**
 * Automation-rule documents under `<root>/<id>.json`.
 * @module @deepseek-ai/dsh-automation/persist
 */

import { readFile, readdir, unlink } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { AUTOMATION_FORMAT_VERSION, AutomationId, type AutomationRule } from './types.ts'

const FILE_EXT = '.json'
const MAX_BYTES = 64 * 1024
export const AUTOMATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

interface AutomationFile {
  readonly formatVersion: typeof AUTOMATION_FORMAT_VERSION
  readonly rule: AutomationRule
}

/**
 * Absolute path of one rule document.
 * @param root - rules directory.
 * @param id - kebab-case id.
 * @returns the document path.
 */
export function automationPath(root: string, id: string): string {
  if (!AUTOMATION_ID_PATTERN.test(id)) {
    throw new Error(`automation id "${id}" is not kebab-case (1–32 lowercase letters, digits, hyphens)`)
  }
  return join(root, `${id}${FILE_EXT}`)
}

/**
 * Mint a kebab id from a display name.
 * @param name - display name.
 * @param taken - ids already in use.
 * @returns a kebab id.
 */
export function idFromName(name: string, taken: ReadonlySet<string>): AutomationId {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  const seed = base === '' ? 'automation' : base
  let candidate = seed
  let n = 2
  while (taken.has(candidate) || !AUTOMATION_ID_PATTERN.test(candidate)) {
    candidate = `${seed}-${n}`
    n += 1
  }
  return AutomationId(candidate)
}

/**
 * List persisted rules, skipping unparseable files.
 * @param root - rules directory.
 * @returns rules sorted by id.
 */
export async function listAutomationFiles(root: string): Promise<AutomationRule[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
  const out: AutomationRule[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(FILE_EXT)) continue
    const id = entry.name.slice(0, -FILE_EXT.length)
    try {
      out.push(await readAutomationFile(root, id))
    } catch {
      // A corrupt document stays on disk; the listing omits it.
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

/**
 * Read one rule document.
 * @param root - rules directory.
 * @param id - kebab-case id.
 * @returns the rule.
 */
export async function readAutomationFile(root: string, id: string): Promise<AutomationRule> {
  const raw = await readFile(automationPath(root, id), 'utf8')
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    throw new Error(`automation "${id}" exceeds ${MAX_BYTES} bytes`)
  }
  const parsed = JSON.parse(raw) as AutomationFile
  if (parsed.formatVersion !== AUTOMATION_FORMAT_VERSION) {
    throw new Error(`automation "${id}" has formatVersion ${String(parsed.formatVersion)}, expected ${AUTOMATION_FORMAT_VERSION}`)
  }
  if (parsed.rule.id !== id) {
    throw new Error(`automation "${id}" document id "${parsed.rule.id}" does not match the file name`)
  }
  assertRule(parsed.rule)
  return parsed.rule
}

/**
 * Write one rule document atomically.
 * @param root - rules directory.
 * @param rule - the rule to persist.
 */
export async function writeAutomationFile(root: string, rule: AutomationRule): Promise<void> {
  assertRule(rule)
  await writeFileAtomic(
    automationPath(root, rule.id),
    `${JSON.stringify({ formatVersion: AUTOMATION_FORMAT_VERSION, rule }, null, 2)}\n`,
    { mode: 0o600, dirMode: 0o700 },
  )
}

/**
 * Delete one rule document. Missing is success.
 * @param root - rules directory.
 * @param id - kebab-case id.
 */
export async function deleteAutomationFile(root: string, id: string): Promise<void> {
  try {
    await unlink(automationPath(root, id))
  } catch (error) {
    /* v8 ignore start -- unlink fails only for unexpected filesystem errors */
    if (isMissingPathError(error)) return
    throw error
    /* v8 ignore stop */
  }
}

function assertRule(rule: AutomationRule): void {
  if (!AUTOMATION_ID_PATTERN.test(rule.id)) {
    throw new Error(`automation id "${rule.id}" is not kebab-case`)
  }
  if (rule.name.trim() === '') throw new Error(`automation "${rule.id}" needs a non-empty name`)
  if (rule.prompt.trim() === '') throw new Error(`automation "${rule.id}" needs a non-empty prompt`)
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
