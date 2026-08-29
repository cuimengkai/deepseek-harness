# Agent Note: Agent settings hub unifies presets and modes

Status: implemented

English | [中文](2026-08-29-agent-settings-hub.zh.md)

## Problem

Capability presets and orchestration modes are related (`Mode = preset bind + flow`) but lived as two peer settings nav rows. Users could not tell which surface chose what a new session runs, and deep links between a mode’s bound preset and the preset roster were missing. Duplicate page titles and divergent roster affordances amplified the confusion.

## Decision

Merge settings navigation into one **Agent** section (`id: agent`, order 20) whose tabs are contributed through `settings.agent.tab`: **Capabilities** (owned by `dsh-client-ui-agent-preset`) and **Orchestration** (owned by `dsh-client-ui-agent-mode`). The hub owns title/intro and a short build-order overview; tab panels drop duplicate `h2`s. Legacy paths `/settings/agent-presets` and `/settings/agent-modes` rewrite to `/settings/agent?tab=presets|modes`. Query deep links `?preset=` / `?mode=` open the matching canvas and strip after consume; mode cards and the composer can jump to the bound capability pack via `?tab=presets&preset=`. Mode composer gains Save all when bind and/or flow are dirty; try-run and Creator handoff copy state that they do not switch the session’s preset.

**Session product path** (scenario-first hero, first-intent `startEntry`, demoted advanced preset chip) is owned by [scenario Agent product path](2026-08-29-scenario-agent-product-path.md); this note no longer claims sessions stay preset-first.

## Alternatives considered

- **Keep two settings nav rows with cross-links only** — rejected: peer nav implied two peer product units and duplicated chrome.
- **Nest modes under each preset card** — rejected: a mode is a first-class authoring unit with its own roster, copy, and canvas; nesting would hide modes that share a preset.
- **Mode-first sessions in the same PR as the hub** — deferred then; landed in the scenario product-path note.

## Consequences

- Preset and mode packages collaborate through `settings.agent.tab` without importing each other’s React trees; path helpers for deep links are duplicated or hub-owned.
- Shipped preset display names say “preset”, not “mode”, so they do not collide with orchestration modes.
- Engine follow-ups (join, HITL, `childPresetId` runtime) stay out of the hub UX slice; scenario start is covered by the product-path note.
