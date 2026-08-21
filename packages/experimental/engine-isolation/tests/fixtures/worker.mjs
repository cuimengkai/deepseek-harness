// Keyless fixture engine worker for the process-out driver spec: reads one
// drive JSON line from stdin, commits a minimal durable session JSONL log
// under --logroot, prints the single result line, and exits 0. Standalone
// plain-Node ESM on purpose — the driver spawns it without tsx.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) throw new Error(`missing --${name}`)
  return process.argv[index + 1]
}

const storePath = arg('store')
const logRoot = arg('logroot')
const sessionId = arg('session')

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const drive = JSON.parse(Buffer.concat(chunks).toString('utf8'))

const now = Date.now()
const log = join(logRoot, `${sessionId}.jsonl`)
await mkdir(logRoot, { recursive: true })
await writeFile(log, [
  JSON.stringify({ type: 'session', version: 1, id: sessionId, createdAt: now, cwd: drive.cwd }),
  JSON.stringify({ type: 'turn/start', seq: 1, time: now, data: { turn: 1 } }),
  '',
].join('\n'))

const result = JSON.stringify({ ok: true, sessionId, pid: process.pid, storePath, logRoot })
process.stdout.write(result + '\n', () => process.exit(0))
