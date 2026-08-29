# Agent Note: Results panel reuses the AppFrame details column

Status: implemented

English | [中文](2026-08-29-results-panel-as-details.zh.md)

## Problem

Mainstream Agent products (WorkBuddy, Claude, Codex) keep a right-hand **session results** rail — artifacts, workspace files, changes — opened from the conversation header, independent of selecting a tool call. DeepSeek Harness already had a third AppFrame column (`details`), but it only showed tool-call inspect chrome, so users had no place to review session outputs without hunting tool rows.

## Decision

Reuse the existing `details` column as the **Results** panel instead of adding a fourth grid track or a new route:

- Tabs: **Artifacts | Changes | Files | Inspect**. Inspect is the previous tool-details body; selecting a tool still opens the column and focuses Inspect.
- Header utility `conversation.session.header.utilities` (`id: results`, order −20) toggles the column via `ctx.layout.toggleDetails` / `openDetails` / `subscribeDetails`.
- Artifact and change lists project session-level produced paths from Chat Turn `deliverables` data (same vocabulary as `ui-deliverables`); Files shows those paths plus the session cwd label (read-only, not a full IDE tree).
- First produced path auto-opens the column; a badge remains while closed with pending artifacts.

## Alternatives considered

- **New `ui-results` package + fourth column** — rejected: AppFrame already solves geometry, drag, and session-gated occupancy; a parallel column would duplicate layout contracts.
- **Keep details as tool-only; put artifacts only in the turn tail** — rejected: turn-tail chips are ephemeral and do not match the “open results anytime” habit.
- **Open results only when a tool row is clicked** — rejected: that ties acceptance to inspect, which is the gap versus WorkBuddy’s independent right rail.

## Consequences

- `dsh-client-ui-chat` owns both the Results shell and the header toggle; layout gains mirrored open-state readers for the toggle without moving panel geometry out of the root store.
- Tool-card details tests mount the same `DetailsPanel` and must pass `openFile`; Inspect remains the selected-tool surface.

## Testing

Unit: layout `toggleDetails`/`syncPanels`, chat apply registers `details` + `results` utility, DetailsPanel Results title / Inspect empty path. Playwright: seeded produced-files session → Results toggle opens the panel with an Artifacts or Changes entry.
