---
description: "The automation group map: app-running-only scheduled session prompts, for users and maintainers navigating the group."
kind: "package-group"
---

# automation/ — App-running scheduled prompts

English | [中文](README.zh.md)

## Summary

The automation group persists global schedule rules and fires them only while the Host process is alive: a due rule creates a session through `sessionController` and queues the rule's prompt. Rules survive restart; firing does not — this is not wake-from-closed durability and not `dsh-schedule` (session-local reminders). This page maps the group; the package README owns the per-package contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`automation/`](automation/README.md) | Persist rules and evaluate them on an in-process timer; due rules start a session and queue a prompt | `ctx.automation` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Session-local Schedule](../schedule/README.md) — reminders that stay inside one conversation log. Do not reuse that package for global app-running rules.
- [Connector registry](../mcp/connector-registry/README.md) — MCP cards a fired session may already have mounted on the Host.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
