# Agent Note: The add flow is one vertical dialog — preset grid above, prefilled configuration below

Status: implemented

English | [中文](2026-08-28-models-add-dialog-embedded-form.zh.md)

## Problem

Adding a provider was a tour of windows: the pick dialog named the provider, the configuration then opened in a second editor dialog, and declaring a custom route was a third dialog behind a grid cell. The user's request — "点击新增之后，上面显示提供方，下面显示配置信息，当选中某个提供方的时候，需要将该提供方的一些默认内置信息自动填入配置中……还要有高级选项……每次新增默认选中自定义" — asks for cc-switch's `AddProviderDialog` posture: one dialog with the presets above and the configuration below, a picked provider's built-in identity prefilled, the advanced fields folded, and the custom form as the default selection.

## Decision

- **One vertical dialog, never a second window.** The pick dialog widens to a 75vw minimum and caps at the viewport height; the presets and the configuration form live in ONE scroll container that auto-grows with its content and scrolls as a whole past that cap — never a separate scroll for the preset flow, and never a second window. `DialogState`'s `pick` kind carries the picked target inline and the `declare` kind is deleted: clicking a cell swaps the embedded form, and clicking another cell swaps it again. The declare dialog and its `customTitle` locale key are gone.
- **The presets flow; the form continues the same surface.** The preset cells flow left-to-right then top-to-bottom at their natural width (`flex-wrap`, replacing the stretched `repeat(auto-fill, minmax(150px, 1fr))` grid — a wide dialog gains columns instead of widening every cell), and the embedded form drops the module fill the standalone editor wears (`embedded` prop on `ProviderEditor`/`CustomProviderCard`), so the flow above and the form below read as one region rather than two stacked cards. The Modal primitive gained a `bodyClassName` prop for this: the pick dialog's card caps at `calc(100vh - 48px)`, its content and body regions shrink (`min-height: 0`), and the single scroll container below the pinned search takes the overflow.
- **The custom form is the default selection.** The dialog opens with the custom creation card mounted under the grid — no target selected IS the custom form — and the custom cell carries the same selected styling and `aria-pressed` state a picked preset gets, so clicking it after picking a preset swaps back. A hand-declared route needs no separate entry point.
- **Picking a preset prefills the built-in identity.** `ProviderEditor` takes a `prefill` flag and seeds its draft with the directory entry's `displayName`, so the picked provider's name lands in the form and in the eventual write. The endpoint is deliberately NOT prefilled: a dormant preset has no endpoint in its schema or its profile, so there is no value to seed, and the field's placeholder still shows the provider default.
- **Every family folds its advanced fields behind 高级选项.** The pi-ai form leads flat with display name, endpoint, and key — the OpenClaw posture — and the fold carries the credential reference, the custom User-Agent, a hand-declared route's protocol, and the model list. The deepseek form leads with its key and keeps `baseURL` plus its model catalog in the same fold. The `customized` locale key is renamed `advanced`; `userAgent` is added.
- **The credential reference is editable, blank meaning derived.** The fold's credential field writes `apiKeyEnv` directly, with `deriveKeyRef(route)` as its placeholder: a named reference is the one knob a shared or pre-provisioned credential needs, and an empty field keeps the `<ROUTE>_API_KEY` derivation the page already owns. The create card applies the same rule — a named reference wins over the derived one.
- **The User-Agent header is one key of the profile's `headers` dict.** Editing it writes `headers['User-Agent']` alone — the rest of the dict rides along untouched — and clearing it drops the dict itself when nothing remains, so a profile never stores an empty object.

## Alternatives considered

- **Keep the second configuration dialog** — rejected: the user asked for the vertical single-dialog cc-switch flow explicitly; the second window made add a three-step tour (pick → second window → configure), and the declare card added a fourth path.
- **Prefill the endpoint too** — rejected: dormant presets carry no endpoint anywhere, so seeding one would invent a value the directory never owned; the placeholder naming the provider default is the honest fill.
- **A fixed credential reference, no field** — rejected: the derived reference covers the conventional case, but a deployment pointing at a shared or pre-provisioned secret needs to name it, which is exactly the one knob the fold exposes.
- **Full configuration-JSON editing, proxy override, and fallback-model fields** — deferred: the curated-set limitation stands; fields beyond the set remain owned by `settings.yaml`, and inventing schema surface for them here would drift from the namespaces' own schemas.

## Consequences

- One fewer dialog kind and one fewer locale title; the add flow's states are `edit` and `pick` only.
- The add flow's writes now carry the prefilled `displayName` (the profile write emits a `displayName` op beside `apiKeyEnv`), so a create can no longer land as an empty profile plus a key.
- The provider `<select>` for switching targets in the picked editor is gone — switching targets is clicking another cell, the same gesture that picked the first one.
- The fold relabel changes what tests click (`advanced`, not `customized`), and the field-order case now pins the lead-flat-then-fold layout for both families instead of the old flat pi-ai assertion.

## Verification

- `components.client.spec.tsx`: the add cases pin the embedded flow — the dialog opens with the custom form, picking a preset embeds the prefilled editor (placeholder still the provider default, key placeholder native), the picked cell is `aria-pressed`, the create writes the `displayName` op beside `apiKeyEnv`, provider-native creation writes the `displayName` op alone, and the conflict-retry case carries `displayName` through the refreshed fixture so only the credential stage retries.
- `provider-form.client.spec.tsx`: the create-card cases open through the default custom form (no declare step), the field-order case pins every family's layout (identity/endpoint/key flat; protocol, credential reference, User-Agent, and models folded), and the cancel/reopen cases assert the custom form's route field rather than a dialog title.
- `styles.client.spec.tsx`: a stylesheet-contract case pins the one-container posture — the preset flow wraps (`flex-wrap`, no grid tracks, no own scroll), the form region carries no border/background/padding, the pick dialog caps at `calc(100vh - 48px)`, and the single scroll container is the only `overflow-y: auto`. `ui-primitives`' Modal test covers the new `bodyClassName` hook the capped dialog shrinks through.
- `ui-settings-models` suite 235/235; `tsc -b` in the package green; `pnpm run lint` green; `lib/client.js` (all client packages, including `ui-primitives`) and the web frontend `dist` rebuilt.

## Related

- [Models settings provider list](2026-08-27-models-settings-card-grid.md) — the page posture this add flow lives in; its pick-dialog and editor-fold facts are updated to match this change.
- [Web config plane](2026-07-30-web-config-plane.md) — the data contract and write-only credential seam the embedded form still writes through.
