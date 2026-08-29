# Agent Note: WorkBuddy project bundle

Status: implemented

English | [中文](2026-08-30-project-bundle.zh.md)

## Problem

The Projects destination listed Host workspaces only. A WorkBuddy project is a shared bundle: name, global instructions, connector ids, expert presets, skill paths, and `sharedRoot` as the workspace. Treating a workspace row as that bundle would hide the extra fields and invent multiplayer hosting the product does not run.

## Decision

1. **`@deepseek-ai/dsh-project-bundle`** (`ctx.projectBundles`) persists cards under `$DSH_HOME/projects/<id>.json`. Remote: `list` / `create` / `update` / `remove` / `prepareStart`.
2. **`prepareStart(id)`** enables listed connectors when `ctx.connectors` is present and returns the bundle. The client creates a session with `cwd = sharedRoot` and the first `expertPresetIds` entry as `agentPreset` when present.
3. **Projects page** creates and starts bundles, and still lists local workspaces as a `sharedRoot` picker. This is not a hosted multiplayer cloud.

## Alternatives considered

- **Workspace row is the project** — rejected: a workspace has no instructions, connector list, or expert roster.
- **Auto-mount every skill path and extra expert** — deferred: v1 enables connectors and returns the first expert id; remaining paths stay on the card.

## Consequences

- Skills and extra experts are listed, not mounted by this package.
- Starting a bundle does not attach the session to a workspace entity unless `sharedRoot` already is one.

## Testing

Keyless: `packages/preset/project-bundle/tests/service.spec.ts` (create/update/prepare/remove, disk reload). `packages/client/ui-workspace/tests/projects-page.client.spec.tsx` renders the bundle form beside workspaces.
