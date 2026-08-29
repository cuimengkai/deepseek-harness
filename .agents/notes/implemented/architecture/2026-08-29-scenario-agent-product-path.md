# Agent Note: Scenario Agent product path (settings authoring + session capability)

Status: implemented

English | [中文](2026-08-29-scenario-agent-product-path.zh.md)

## Problem

Capability presets and orchestration modes are the right runtime split, but product surfaces sold them as two peer mysteries on the session screen. Putting both a scenario chip and a capability chip on the hero competed for attention and implied the session bound two peer choices. The session shell also lacked the mainstream three-column habit (sidebar tasks · center conversation · right results).

## Decision

- **Session shell** matches WorkBuddy-style three columns: sidebar for tasks, center for conversation + composer, right `details` remapped as the Results panel ([results panel note](2026-08-29-results-panel-as-details.md)). Primary nav, Assistant empty-state categories, and honest Projects/Automation placeholders are owned by the [WorkBuddy final IA note](2026-08-29-workbuddy-final-ia.md).
- **Session** binds **capability** only (`agentPresets.select`). The composer tool row shows the capability chip **immediately after** the permission control (`conversation.input.left`, order −10).
- **Scenario** (= mode: bound capability + entry flow) is authored and try-run in the Agent settings hub. **Use for new session** stages the mode’s **bound preset** onto a blank session — it does not expose a scenario chip or start dock on the session surface.
- Do **not** empty-run entry flows on `session.create`. Settings try-run still uses `agentModes.tryRun` / `startEntry` under the current session agent when builders need it.
- Empty state keeps brand + category chips + capability quick row + workspace chip + the same composer; no guidance cards or scenario dock.
- Copy: session face = Capabilities / 能力; builder face = Scenario agent / 场景 Agent with Capabilities + Orchestration tabs.

## Alternatives considered

- **Scenario-first hero + start dock** — rejected for session chrome clutter; capability is the session’s durable bind.
- **Silent auto-start on create with empty input** — rejected: Chatflow-style apps need user intent as flow input ([binding note](2026-08-29-agent-modes-preset-flow-binding.md)).
- **Collapse preset and mode into one on-disk format** — rejected: mount vs executable graph stay separate packages.
- **Fourth AppFrame column for results** — rejected; remapping `details` is owned by the results-panel note.

## Consequences

- `dsh-client-ui-agent-preset` owns the composer capability chip, header label, hero category chips, and blank-session capability quick row; `dsh-client-ui-agent-mode` owns settings Orchestration only (no session scenario dock).
- Hero seat `conversation.hero.agentMode` remains declared unused; `conversation.hero.agentPreset` hosts category chips.
- Chat owns the Results shell and header Results toggle; tool inspect is one Results tab.

## Testing

Unit coverage for seat select on blank sessions and composer `conversation.input.left` registration. Settings try-run / `startEntry` stay covered in agent-modes host tests. Results registration and header toggle covered in ui-chat / ui-layout tests; Playwright smoke opens Results on a produced-files seed.
