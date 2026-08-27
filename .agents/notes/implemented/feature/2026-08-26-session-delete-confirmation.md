# Agent Note: Session deletion asks for confirmation

Status: implemented

English | [中文](2026-08-26-session-delete-confirmation.zh.md)

## Problem

The session row's Delete action committed immediately: one menu click physically removed the session's log and its whole subagent tree through `ctx.sessions.delete` ([[2026-08-19-session-deletion]], [[2026-08-23-stop-then-delete-session-deletion]]). Workspace deletion already opens a confirmation dialog that states its consequences and blocks duplicate submission ([[2026-07-27-workspace-registration-deletion]]), so the more destructive of the two row actions was the only unguarded one, and a mis-click in the row menu was unrecoverable by design.

## Decision

Session deletion now reuses the browser-owned confirmation pattern Workspace deletion established, entirely inside `@deepseek-ai/dsh-client-ui-workspace`:

- The row menu's Delete item opens a `Modal` instead of committing. The item gains `danger: true`, matching the workspace menu's destructive styling; archive keeps its plain styling because it is non-destructive and stays dialog-free.
- The row dispatches the display title beside the id (`onDelete(id, title)`), so the dialog's description can name the exact row the way the rename dialog prefill does.
- The dialog states irreversibility — the message log and the whole subagent tree are permanently removed, the action cannot be undone — and offers Cancel plus Delete. While the request is pending both controls are disabled and duplicate confirmation is ignored; Escape and Close cannot dismiss an in-flight deletion.
- Failure keeps the dialog open with the error rendered inside it (the old list-area alert seat is gone — every delete failure now happens inside the dialog); Cancel dismisses a failed dialog without retry.
- Success alone does not close the dialog: the browser waits until its `useSessions` projection has dropped the deleted id, the same echo-committed closing the workspace dialog uses, so the deleted row never flashes back for one frame.

The wire, the host, and the deletion service are untouched; only the presentation seam changed.

## Alternatives considered

- **Keep direct commit, guard only the current session** — rejected: every persisted session's log is equally unrecoverable, and the requested parity with workspace deletion is a uniform rule.
- **A native `confirm()`** — rejected: the app's dialog vocabulary is the shared `Modal` from `ui-primitives`; the workspace flow already proves the composed pattern with focus, Escape, and Close handling.
- **Close the dialog on RPC success** — rejected: one stale React frame would resurrect the row during the next gesture; the projection-settled close is the established fix for exactly that race.
- **Reuse the workspace delete dialog with a mode flag** — rejected: the two copies differ in copy, target keying (`WorkspaceId` vs `SessionId`), and echo source (`useWorkspaces` vs `useSessions`); a shared abstraction would couple two independent row lifecycles for ~40 lines of parallel structure.

## Verification

`rows.client.spec.tsx` pins the danger styling and the `(id, displayTitle)` dispatch. `workspace-browser.client.spec.tsx` pins the full dialog lifecycle: the menu opens the dialog without calling the action, the description names the row and states irreversibility, duplicate confirmation submits once, both buttons disable while pending, the pending status renders, Escape/Close cannot dismiss mid-flight, RPC success keeps the dialog open until the sessions projection drops the id, a refusal renders inside the dialog and Cancel closes it, and Cancel/Escape/Close before submission never delete.

## Consequences

- One menu click can no longer destroy a session log; the only path to deletion is the dialog's Delete button.
- The stop-then-delete note's "alert in the UI" consequence now names the dialog as the alert's home rather than the list area.
- The deletion refusal semantics are unchanged: a scope member that stays live after disposal still refuses the whole operation, now visible inside a dismissable dialog.
