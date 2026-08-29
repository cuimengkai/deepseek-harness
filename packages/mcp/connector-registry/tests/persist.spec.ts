/**
 * Connector document read/write and id minting.
 * @module tests/persist
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConnectorId, CONNECTOR_FORMAT_VERSION, type ConnectorEntry } from '../src/types.ts'
import {
  connectorPath,
  deleteConnectorFile,
  idFromName,
  listConnectorFiles,
  readConnectorFile,
  serverNameFromName,
  writeConnectorFile,
} from '../src/persist.ts'

const entry = (id: string, extra: Partial<ConnectorEntry> = {}): ConnectorEntry => ({
  id: ConnectorId(id),
  name: 'Docs',
  enabled: false,
  serverName: 'docs',
  transport: 'streamable-http',
  url: 'https://mcp.example.com',
  updatedAt: 1,
  ...extra,
})

describe('connector persist', () => {
  it('refuses a non-kebab path and mints unique empty-name ids', () => {
    expect(() => connectorPath('/tmp', 'Not Valid')).toThrow('kebab-case')
    expect(idFromName('   ', new Set())).toBe('connector')
    expect(idFromName('Docs', new Set(['docs']))).toBe('docs-2')
  })

  it('lists nothing from a missing directory and skips corrupt files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-conn-persist-'))
    try {
      expect(await listConnectorFiles(join(root, 'missing'))).toEqual([])
      await writeConnectorFile(root, entry('ok'))
      await writeFile(join(root, 'notes.txt'), 'skip')
      await writeFile(join(root, 'bad.json'), '{')
      await writeFile(join(root, 'wrong-ver.json'), JSON.stringify({
        formatVersion: 99,
        entry: entry('wrong-ver'),
      }))
      await writeFile(join(root, 'mismatch.json'), JSON.stringify({
        formatVersion: CONNECTOR_FORMAT_VERSION,
        entry: entry('other'),
      }))
      const listed = await listConnectorFiles(root)
      expect(listed.map(item => item.id)).toEqual(['ok'])
      await expect(readConnectorFile(root, 'wrong-ver')).rejects.toThrow('formatVersion')
      await expect(readConnectorFile(root, 'mismatch')).rejects.toThrow('does not match')
      await deleteConnectorFile(root, 'ok')
      await deleteConnectorFile(root, 'ok')
      expect(await listConnectorFiles(root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses an incomplete document on write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-conn-assert-'))
    try {
      await expect(writeConnectorFile(root, entry('x', { name: '  ' }))).rejects.toThrow('non-empty name')
      await expect(writeConnectorFile(root, entry('x', { url: '' }))).rejects.toThrow('needs a url')
      await expect(writeConnectorFile(root, {
        ...entry('x'),
        transport: 'stdio',
        command: '',
      })).rejects.toThrow('needs a command')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses oversized, mismatched, and illegal documents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-conn-more-'))
    try {
      await writeFile(join(root, 'huge.json'), `${'x'.repeat(65 * 1024)}`)
      await expect(readConnectorFile(root, 'huge')).rejects.toThrow('exceeds')
      await writeFile(join(root, 'mismatch.json'), JSON.stringify({
        formatVersion: CONNECTOR_FORMAT_VERSION,
        entry: entry('other'),
      }))
      await expect(readConnectorFile(root, 'mismatch')).rejects.toThrow('does not match')
      await writeConnectorFile(root, entry('a'))
      await writeConnectorFile(root, entry('b', { serverName: 'b' }))
      expect((await listConnectorFiles(root)).map(item => item.id)).toEqual(['a', 'b'])
      expect(serverNameFromName('Taken', new Set(['Taken']))).toBe('Taken_2')
      await expect(writeConnectorFile(root, entry('NotValid' as ConnectorEntry['id']))).rejects.toThrow('kebab-case')
      await expect(writeConnectorFile(root, entry('x', { serverName: '!!!' }))).rejects.toThrow('legal MCP')
      await expect(writeConnectorFile(root, {
        ...entry('x'),
        transport: 'ftp' as ConnectorEntry['transport'],
      })).rejects.toThrow('unknown transport')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('throws when the root exists but is not a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-conn-file-'))
    const file = join(dir, 'not-dir')
    await writeFile(file, 'x')
    await expect(listConnectorFiles(file)).rejects.toThrow()
    await rm(dir, { recursive: true, force: true })
  })
})
