# @deepseek-ai/dsh-command-session-delete

English | [中文](README.zh.md)

Human-facing `/session-delete` command over [`ctx.sessionDeletion`](../session-deletion/README.md). The plugin registers one global command through [`ctx.commands`](../../interaction/commands/README.md), so every composed command adapter executes it without a model turn.

## Command contract

| Input | Result |
|---|---|
| `/session-delete <sessionId>` | Physically delete the named session and its whole subagent descendant tree, then report the count. |
| `/session-delete <sessionId>` with no durable artifact | `Session "<id>" not found.` |
| `/session-delete <sessionId>` while a scope member is live | `Cannot delete running session(s): <ids>. Stop them before deleting.` |
| `/session-delete` or `/session-delete <a> <b>` | `Usage: /session-delete <sessionId>` — exactly one id argument. |

Every resolved invocation records the executor-owned log-only pair `command/run` / `command/done`; neither event joins model history. Expected `SessionDeletionError` codes become stable direct errors; unexpected failures reject dispatch, and cancellation settles as `Deletion cancelled.`. Plugin disposal first unregisters `/session-delete`, then drains every handler that already started.

## Composition

The producer injects `commands` and `sessionDeletion`. Mount the command registry, the deletion seam, and this plugin:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: session-deletion
  name: '@deepseek-ai/dsh-session-deletion'
- id: command-session-delete
  name: '@deepseek-ai/dsh-command-session-delete'
```

## Known Limitations and Deferred Work

- **No confirmation and no bulk selection** — the command deletes the whole subagent descendant tree in one shot from a single id argument; there is no per-member confirmation and no way to select several roots at once.
