# @deepseek-ai/dsh-client-ui-flow-editor

English | [中文](README.zh.md)

A visual flow canvas as one `conversation.view` entry ("Flow") at ring order 15 — after the trajectory tab (10) and before the develop-mode insight tabs (20+). The canvas authors, persists, runs, and watches branching multi-agent flows against the host flow engine [`@deepseek-ai/dsh-flow`](../../workflow/flow/README.md): add agent, condition, and loop nodes, connect them, and drive a run.

The entry is general-purpose — it is not gated to any agent preset. A session whose composition mounts the flow engine can author and run branching workflows; without the engine the host answers every `flow.*` call with `flow-unavailable` and the tab renders a read-only notice instead of the canvas. The shipped `dsh-web-app` composition mounts the engine, so the canvas is live by default; the notice is the fallback for a custom composition that omits it.

Each session owns a `FlowEditorController` keyed off its current `cwd` from the sessions feed, so a workspace switch reloads the canvas for the new directory. The controller:

- lists and opens the session's saved flows (`flow.list` / `flow.get`), defaulting to the most recently saved flow or an unsaved starter when the directory is empty;
- saves, renames, and deletes flows (`flow.save` / `flow.delete`), minting an id from the graph name on first save;
- edits the graph locally (nodes, edges, agent prompt, the provider/model route, and per-kind model routes) and starts runs (`flow.run`) with a JSON input box; a parse failure refuses the run before any wire traffic;
- polls `flow.getRun` every 800 ms until a run settles, paints per-node status on the canvas, and lists run history (`flow.listRuns`); `flow.stop` cancels the live run.

Agent options carry only non-empty provider/model values, and each per-kind route likewise drops a cleared field or kind: clearing a field drops the key instead of sending an empty string, matching the engine's `!== undefined` option semantics.

The canvas is a pan-and-zoom dot grid. A left palette offers draggable Agent, Condition, and Loop chips (the toolbar buttons remain as an accessibility fallback); a background drag pans the view, the wheel zooms at the pointer (clamped to 0.2×–2×), and Delete/Backspace removes the selected node or edge. A background drag must pass a 3 px movement threshold to count as a pan; a stationary press stays a click that deselects. Node positions live in graph space under the view transform, so a dropped node lands at the graph point under the cursor.

## Model Experience

Indirectly, through the host flow engine: the graphs the canvas authors and runs compile into the sub-agent prompts `dsh-flow` assembles, and the canvas itself contributes no prompt content.

#### KV Cache effect

None — the canvas adds no prompt content and no run result is part of any model request.

## Known Limitations and Deferred Work

- **Connect-rejection copy is unlocalized** — refused connect messages (self-loop, duplicate, both-branch-full) are literal English strings set on the state; only the run-input refusal is localized.
- **Empty run input is refused as invalid JSON** — the input box defaults to `{}`; clearing it to empty fails `JSON.parse` and refuses the run, so there is no "run with no input" path even though the engine accepts an absent input.
- **No auto-layout** — new nodes cascade right of the rightmost node; there is no auto-arrange, so hand-placed layouts stay as authored.
- **Touch drag works, touch pan deferred** — the canvas sets `touch-action: none`, so a node drag fires on touch (a `pointermove` instead of a `pointercancel`); pointer pan and wheel zoom ship, but touch pan and pinch zoom are still deferred.
- **Polled status, not streaming** — live node status updates on an 800 ms poll of the run snapshot; there is no push channel.
- **Read-only without the engine** — a custom composition that omits the flow engine (the shipped `dsh-web-app` mounts it) shows the notice and no canvas; the failure is `flow-unavailable` on the wire, not a client-side gate.
- **Flows are per-session, not shared** — the saved-flow directory is scoped to the session's `cwd`; two sessions in the same directory do not see each other's drafts until saved.
