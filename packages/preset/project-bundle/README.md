---
description: "Persisted project bundles: name, instructions, connectors, expert presets, skill paths, and a sharedRoot workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-project-bundle

English | [中文](README.zh.md)

`ctx.projectBundles` persists a WorkBuddy-style project card — name, global instructions, connector ids, expert preset ids, skill paths, and `sharedRoot` — under `$DSH_HOME/projects/<id>.json`. `prepareStart(id)` enables the listed connectors (when `ctx.connectors` is present) and returns the bundle so the client can create a session with `cwd = sharedRoot` and the first expert preset.

## Service

`list()`, `create(draft)`, `update(id, draft)`, `remove(id)`, and `prepareStart(id)` are the Remote surface. `sharedRoot` is the workspace directory, not the whole product concept.

## Config

`root` (default `$DSH_HOME/projects`) is the document directory.

## Model Experience

Indirectly: a session started in a project uses that project's `sharedRoot` and may mount its first expert preset. Instructions are returned to the client; they are not a model-facing tool.

#### KV Cache effect

None of its own.

## Known Limitations and Deferred Work

- **Skills and extra expert presets are listed, not auto-mounted** — v1 enables connectors and returns the first expert preset id; remaining skill paths stay on the card for the operator to bind.
- **No multiplayer cloud** — the bundle is a local document, not a hosted project space.
