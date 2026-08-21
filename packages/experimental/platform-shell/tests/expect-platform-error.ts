import { expect } from 'vitest'
import { PlatformShellError, type PlatformShellErrorCode } from '../src/error.ts'

/**
 * Assert that calling `fn` throws a PlatformShellError carrying `code`.
 * Structured error codes are the stable contract; message text is context.
 */
export function expectPlatformError(fn: () => unknown, code: PlatformShellErrorCode): void {
  let thrown: unknown
  try {
    fn()
  } catch (error: unknown) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(PlatformShellError)
  expect(thrown).toMatchObject({ code })
}
