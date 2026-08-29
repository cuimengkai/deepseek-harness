# Agent Note: WorkBuddy final IA (sidebar nav, Assistant empty state, honest placeholders)

Status: implemented

English | [中文](2026-08-29-workbuddy-final-ia.zh.md)

## Problem

The product already remapped `details` to Results and moved scenario authoring into Agent settings, but the left rail and Assistant empty state still read as a generic session browser: “New Session”, no WorkBuddy-style primary destinations, and no honest landing for Projects / Automation. Screenshot-driven product intent requires that IA without inventing connector markets, multiplayer projects, or cron automation the Host does not run.

## Decision

Align the shipped Web shell to the WorkBuddy screenshot IA while keeping dsw tokens (no dark-theme reskin):

- **Sidebar:** “New task” starts a blank session; primary nav is Assistant (`/`), Projects (`/projects` workspace list), Experts · skills (`/settings/agent`), Automation (`/automation` Jobs + orchestration link), More → Settings only. Session list section copy is **Tasks**; blank rows are **Draft**.
- **Destination pages:** `/projects` lists Host workspaces with start/open session actions; `/automation` explains session Jobs and orchestration try-run without cron SaaS — not fake OAuth or scheduler UIs.
- **Assistant empty state:** greeting (`{brand}, I can help`) + segmented category control mapped to shipped presets (`standard` / `develop` / `cordis`, hide if absent) + static category skill starters above the composer (`setDraft`) + verb-style hero placeholder; workspace + permission in the composer context strip; hero `+` menu for file / Plan / Experts / skills. No scenario dock on the session face ([product path](2026-08-29-scenario-agent-product-path.md)).

## Alternatives considered

- **Ship fake Tencent connector / project / cron surfaces** — rejected: no Host backend; would train users on dead ends.
- **Dark-theme WorkBuddy reskin** — rejected: stay on dsw tokens; IA and layout only.
- **Restore scenario dock on the hero** — rejected: orchestration stays in Agent settings ([binding note](2026-08-29-agent-modes-preset-flow-binding.md)).

## Consequences

- `dsh-client-ui-sidebar` injects `router` and `sessions`, owns primary nav chrome, and registers operable Projects / Automation pages.
- `dsh-client-ui-agent-preset` fills `conversation.hero.agentPreset` with a segmented category control (icons + `standard`/`develop`/`cordis`) and `conversation.input.dock` with **static locale skill starters** that `setDraft` into the blank-session composer (not a Host skill marketplace or preset roster chips).
- Assistant empty state greeting is `{brand}, I can help` / `{brand}, 我帮你` (no fish mark or preview badge on the hero title). Workspace chip and permission live in the composer **context strip** under the tool row; hero `+` opens file / Plan / Experts / skills (active sessions keep `+` as commands-only).
- Workspace locale owns the Tasks / Draft metaphor; Results remains the right rail ([results panel](2026-08-29-results-panel-as-details.md)).

## Testing

Unit: sidebar nav + Projects/Automation pages, category chip preset mapping, category skill-row `setDraft`, hero greeting/context strip. Playwright: open Web → see New task and Results; Experts → `/settings/agent`; Projects → workspace list.
