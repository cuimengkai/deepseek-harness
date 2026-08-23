# Agent Note: Compose an agent preset from validated plugin rows

Status: implemented

English | [中文](2026-08-23-agent-preset-row-compose.zh.md)

## Problem

The agent-preset settings section's only authoring path was copy-then-edit-files: `copy` lands an existing preset's whole directory, and everything else happens in the preset's own files, because the authoring boundary was copy-only — "no caller supplies composition text or a path". A user composing an agent from the installed plugins therefore had no page surface; the request was to make the Agent-presets module a drag-and-drop composer that assembles an agent by dragging plugins, while `agent.cordis.yml` stays the underlying format.

## Decision

The host gains one sanctioned browser-facing write. `AgentPresets.compose(id, rows, meta?, { overwrite, assertResolvable })` writes a composition from row structures — `{ id, name, config?, disabled? }`, the JSON-safe subset of a Loader entry — creating it (`overwrite: false`, target id must be free) or replacing a locally authored preset in place (`overwrite: true`, target must exist and be `user`-trusted; a shipped preset is refused). It enforces the preset domain's own row invariants (non-empty rows, a plugin module per row, unique ids) and the "only installed plugins may be composed" rule through a REQUIRED `assertResolvable` proof: the callback returns the module names the rows reference that are not installed, and a non-empty answer refuses the whole composition with `ComposeModuleError`. The wire layer supplies the inventory-backed implementation, so no caller can bypass it. `readRows(id)` parses a composition into the same row structures through the Loader's own YAML dialect (a `!!js` `disabled` node survives), so the composer edits rows and the browser never parses YAML.

The wire extends `agentPreset` with `compose` and adds `rows` to `read`; both are loopback-pinned in the same privileged set as `copy`/`remove`/`openDocument`, because a composition names the plugins a session runs. The compose handler re-checks every named module against `pluginInventory.list()` before anything is written and maps `ComposeModuleError` to `agent-preset-invalid`, a `PresetNotWritableError` (a shipped overwrite target) to `agent-preset-read-only`, and an unknown target to `agent-preset-not-found`.

The client (`dsh-client-ui-agent-preset`) adds a composer to the settings section: a searchable palette of the deployment's installed plugins (from `pluginInventory.list`, deduped — the inventory is entry-ordered and the same module can be shipped by more than one Loader entry, and duplicate React list keys broke keyed reconciliation when the filter shrank the list) that drops into a composition column; rows are reorderable by the same native HTML5 drag-and-drop and removable, and a save needs an id and at least one row. `rowIdFor` derives a row id from a module name (`@deepseek-ai/dsh-tool-bash` → `tool-bash`), appending `-2`/`-3` on collision. Shipped presets keep no compose action — only a `user` copy is composed in place — and the composer is a new authoring path beside copy, not a replacement for it.

`apps/web/tests/agent-preset-composer.e2e.ts` drives the real HTML5 DnD lifecycle keylessly (Playwright's native mouse sequence, zero model calls) and asserts the target user preset's `agent.cordis.yml` lands on disk with exactly the composed rows after drag-in, reorder, remove, and save, plus an in-place edit of a user preset.

## Alternatives considered

**Reuse the existing `write(id, rows, meta)` primitive.** `write` accepted rows as given by a trusted in-process caller and refused occupied ids with no in-place replace; the browser-facing seam needed the domain's row invariants, the installed-module proof, and the create/replace split, so it got its own `compose`, with `write` staying the trusted in-process path.

**Let the service prove resolvability itself.** The roster has no inventory; coupling the preset domain to `pluginInventory` would invert the dependency. Making the proof a required precondition of the write means the operation that decides enforces the rule, and the wire supplies the inventory-backed check — the decision is enforced in the operation that makes it, not in a facade a caller could bypass.

**Accept composition text or a path from the browser.** The copy-only posture existed because text/path authoring is a weak and risky surface; `compose` keeps the browser writing neither — rows are structures, the Host re-checks them, and only a user root accepts the write.

**Ship a DnD dependency.** Native HTML5 DnD with `dataTransfer` and midpoint-based insertion covers desktop drag-in and reorder with no new client dependency; touch devices keep the remove button and a click-to-add path.

## Consequences

The authoring boundary narrows deliberately: the browser now writes compositions, but only row structures, only installed modules, and only into a user root. The preset domain stays the single owner of composition invariants and YAML serialization; the browser never parses or dumps YAML and never supplies a path. The composer reuses the standing roster discovery (a composed preset is visible to the next `list()`), and a save is a per-save event rather than a per-deploy one, which also bounds the superseded-generation cost the README notes. `config`/`disabled`/`inject` values pass through verbatim but are not edited by the composer, and desktop drag-and-drop is the interaction on settings pages where touch is out of scope — both are deferred work recorded in the package README.
