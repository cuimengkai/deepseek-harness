# Agent Note: App-running-only automation scheduler

Status: implemented

English | [中文](2026-08-30-automation-scheduler.zh.md)

## Problem

The Automation destination explained background jobs but had no place to author a recurring prompt. `dsh-schedule` is session-local and log-backed. A cloud cron or OS wake would claim durability the desktop Host does not have: when the process is gone, nothing fires.

## Decision

1. **`@deepseek-ai/dsh-automation`** (`ctx.automation`) persists rules under `$DSH_HOME/automation/<id>.json`. Remote: `list` / `create` / `update` / `setEnabled` / `remove`. `kind` is `interval` | `daily` | `weekly` | `once`. `tickMs` (default 30000) is the in-process timer period.
2. **Fire is create + queue.** A due rule calls `sessionController.create` then `prompt` with `mode: 'queue'`. Missing `sessionController` records `lastError` and does not throw. `tick()` is Host-only for tests.
3. **No wake-from-closed.** The timer runs only while this plugin is loaded. The Automation page states that. This is not `dsh-schedule` and not push notification.

## Alternatives considered

- **Reuse `dsh-schedule`** — rejected: those reminders belong to one session log and require that session to be live.
- **OS or cloud cron** — rejected: the product does not keep a daemon after quit, and must not claim it does.

## Consequences

- A laptop that is off will not fire. Rules are still on disk after restart and evaluate on the next tick.
- There is no OS or mobile push; the fired session appears in the session list.

## Testing

Keyless: `packages/automation/automation/tests/service.spec.ts` (`isDue`, persist CRUD, `lastError` without `sessionController`). The Automation page client tests keep the jobs list and add the rule form.
