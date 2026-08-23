# @deepseek-ai/dsh-client-ui-settings-general

English | [中文](README.zh.md)

Settings shell, ownerless copy, and durable product-onboarding namespace. It occupies `sidebar.settings` with the trigger row and the routed settings page — a `page`-slot entry at `/settings/:section?` that covers the whole window while its path is active — projects the `settings.section` ledger into the page's left nav and URL section parameter, and the `settings.onboarding` ledger into one mounted step at a time (suppressed while the settings route is active), and registers everything on the Settings surface that belongs to no single feature — the trigger/header/close chrome content, the local configuration-file action, the General section and its `settings.general.item` slot, and the `settings` dictionaries. The slot types it renders into belong to ui-settings, the settings domain base; only the shell's own contract types live here, because they reference ui-sidebar's slot type and the base layer must depend on no `ui-*` package. Feature-owned rows (Permission, Language, Appearance), sections (Models), and conditional onboarding steps stay with their feature packages.

The shell ships no onboarding copy of its own — all text arrives from registrants. Nav labels may be locale-following thunks, so the nav projection resolves them through `resolveSlotLabel` and re-renders on the section ledger bump or the locale revision (an optional `ctx.get('locale')` read; no hard locale dependency). The onboarding ledger projects in ascending order and mounts exactly one step at a time; the coordinator keeps its completion state across the route and suppresses every step while the settings route is active, because the covering page must not sit under a step's takeover chrome. Visible steps own their dialog chrome and app-root `inert` lifecycle; a mounted step still resolving private facts renders null, so nothing paints or blocks while it decides. The active registrant receives its id, `complete()`, and an `openSection(id)` callback; completing or skipping transfers ownership to the next entry. Registrants own durable completion, capability readiness, copy, mutations, and their visible wrapper, so independently registered flows cannot stack and the shell does not become a second configuration fact source.

Two slot entries make up the shell: the `sidebar.settings` trigger (navigation + onboarding coordinator) and the `page` entry at `/settings/:section?` (top bar + left nav + section content). The trigger navigates to `/settings` and carries `aria-current` while that route is active; the page reads its active section from the URL parameter, validated against the section ledger with the first row as fallback, so a section can unmount under an active deep link and a bare `/settings` lands on the first section. Closing — the X control, Escape, or a section's `close` owner prop (session-starting flows) — leaves the page for good by navigating to the root, so the covering page is fully gone before the section's own flow takes the foreground; the header back control history-steps instead, with the root fallback for a tab that opened straight on the route. Entering the page focuses the close control; the inert app region keeps focus inside it.

A loopback browser loads the provider's `hasDocument` capability through `settings.describe` and renders **Open configuration file** only when the Host confirms that a provider-owned local document can be prepared. The action sends the pathless, loopback-only `settings.openDocument` request; the Host resolves the provider path again, materializes an absent document, and hands it to a native text editor (`open -t` on macOS, bypassing a browser file association; the desktop file association on Linux and Windows; Windows association after `wslpath -w` translation on WSL). Open failures keep the action available and render a localized error. Reopening the dialog or reconnecting refreshes availability after a transient read failure or Host topology change. Remote browsers never register the action and never issue the privileged settings read.

The Host half registers `ui-onboarding` in the user-settings seam. The welcome step contributed by `ui-settings-models` reads and writes its `welcomeNoticeVersion` through the existing public settings boundary; the shell itself remains policy-free.

## Model Experience

None, as the plugin renders browser settings UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The General section has no built-in rows; each row appears only when its owning feature plugin is mounted.
- Section state lives in the URL — the active section is the `/settings/:section?` parameter (first-row fallback), so the page cannot hold a section open independently of the route; a navigation, back, or reload moves with the URL.
