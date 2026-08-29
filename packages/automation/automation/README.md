---
description: "App-running-only automation scheduler: persist rules and fire a session prompt while the Host process is alive."
kind: "package-reference"
---

# @deepseek-ai/dsh-automation

English | [中文](README.zh.md)

`ctx.automation` persists schedule rules under `$DSH_HOME/automation/<id>.json` and evaluates them on an in-process timer. A due rule creates a session through `ctx.sessionController` and queues the rule's prompt. Rules survive process restart; firing does not — this package does not wake a fully closed app.

## Service

`list()`, `create(draft)`, `update(id, draft)`, `setEnabled(id, enabled)`, and `remove(id)` are the Remote surface. `kind` is `interval` | `daily` | `weekly` | `once`. `tick()` is the Host-only re-evaluation tests call.

## Config

`root` (default `$DSH_HOME/automation`) is the document directory. `tickMs` (default 30000, min 1000, max 3600000) is the timer period.

## Model Experience

Indirectly: a fired rule becomes a user prompt on a new session. The scheduler exposes no model-facing tool.

#### KV Cache effect

None of its own; the new session starts a new request prefix.

## Known Limitations and Deferred Work

- **No wake-from-closed durability** — the timer runs only while this process is loaded. A laptop that is off will not fire.
- **This is not `dsh-schedule`** — session-log follow-ups stay in that package; this roster is global and app-running-only.
- **No push notification** — the fired session appears in the session list; there is no OS or mobile push.
