# Agent Note: Develop pick survives a started session

Status: implemented

English | [中文](2026-08-24-develop-pick-survives-started-session.zh.md)

## Problem

A preset pick made while a running session is current was dropped as unservable. `AgentPresetSeatController.apply()` cleared the stage and reported settlement (`onStageSettled` → `clearPendingAgentPreset`) whenever the current session had already started, on the rule that the host refuses to swap a started session's preset. That is true — the swap is refused — but the drop assumed the stage was meant for the CURRENT session. The hero chip's pick names the NEXT session, and a develop pick that precedes an import is exactly that: the user is in a running session, picks develop for the project they are about to import, and the import's `connectWorkspace` is what should create the new session under develop. Because `apply()` had already cleared the workspace pending, the connect's create arm opened the imported session on the deployment default, and the develop-mode auto-scan never fired.

## Decision

`apply()` keeps the stage when the current session has started, instead of settling it as unservable. A started session cannot take the choice, but the pick still names the session the next connect is about to create, so the stage stays pending until a blank session appears to consume it — whether the connect's create arm carries it in the wire payload or the list-change applier applies it to a reused blank session. The stage still settles when a blank session already runs it, or when the host rejects or refuses the apply.

This revises decision point 2 of [workspace-pick-preset-fallback](../architecture/2026-08-23-workspace-pick-preset-fallback.md): "dropped as unservable" is no longer a settlement point for a started session. The other two settlement points — applied, and rejected — are unchanged, and `clearPendingAgentPreset` still protects later unrelated connects from a stale stage once a stage has genuinely settled.

## Alternatives considered

- **Keep dropping, and have the import flow re-stage** — the import entry already calls `connectWorkspace`, which reads the pending preset, so the re-stage would have to happen inside the import path; that couples the workspace connect to the preset choice in a second place instead of the one stage→note mechanism.
- **Settle only on a real consumption, never on the refusal branch** — this is the chosen shape: the refusal branch now returns without settling, so a pick made against a started session behaves exactly like a pick made with no session current.

## Consequences

- A develop pick made while a running session is current survives to the next connect, so an imported project's session is created under develop and the project-insight auto-scan fires.
- A stage against a started session stays sticky: the chip keeps showing the staged pick until a blank session takes it or the host refuses the switch.
- The `agent-preset-locked` refusal still exists — the seat never asks the host to swap a started session — but the refusal no longer cancels the pending stage.
