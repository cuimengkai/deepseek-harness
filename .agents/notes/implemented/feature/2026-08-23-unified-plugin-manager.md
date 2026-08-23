# Agent Note: Unified plugin manager over every plugin in Web Settings

Status: implemented

English | [中文](2026-08-23-unified-plugin-manager.zh.md)

## Problem

The Web Settings Plugins tab managed two plugin populations differently. The installable catalog (`pluginManager/listAvailable`) had Install/Uninstall, categories, and a source badge; the Loader inventory (`pluginInventory/list`) showed the ~168 harness spine plugins as mounted rows with an enablement tag and **no uninstall action at all**. Users rejected the implicit "built-in" class: a harness plugin could not be removed, could not be reinstalled, had no category, and had no detail view beyond the Loader-tree entry id. They asked, verbatim, to manage every plugin — built-in or external — with the same install and uninstall, grouped by category, with detail views.

Two further defects surfaced while reading the surfaces. Installs made through the manager mount under Loader entry ids carrying the `dsh-managed-` ownership prefix, but those ids surface on the wire with an `include:` getter prefix; the client folded on the bare prefix, so a managed install appeared twice — as its catalog card and as a bare Loader card. And the spine had no display metadata: Loader entries carry only `{ id, name }`, so grouping and describing the harness plugins had no data source.

## Decision

**Uniform management.** The client renders both faces as one grouped list of identical disclosure cards. A Loader entry's `enabled` flag is exactly the installed state, so both faces route through the same `installPlugin(name)` / `uninstallPlugin(name)` remotes; the action button toggles Install/Uninstall on every card. There is no built-in category: a harness plugin uninstalls and reinstalls like any catalog entry.

**Spine uninstall is a persistent disable.** Patches cannot delete rows, so uninstalling a bundled spine plugin writes a `disabled: true` override onto its bare row id in the user home patch (`upsertDisabledOverride`, a locked read-modify-write); the config-HMR watcher recomposes and the fiber unmounts. Install clears the override (`disabled: false`). Both directions are reversible and idempotent. The routing order in `uninstall` is ledger presence (network install) → bundled spine entry → managed static row; `install` routes catalog name → bundled spine entry → static path. The host-side mechanisms are owned by the [live home-patch plugin install note](../architecture/2026-08-22-live-home-patch-plugin-install.md).

**Hard protection for the runtime base.** Five modules the manager executes on cannot be disabled in-process — plugin-manager itself, the inventory it renders, and the API/typert gateways that carry its wire calls (`IRREMOVABLE_MODULES`): `@deepseek-ai/dsh-host-plugin-manager`, `@deepseek-ai/dsh-host-plugin-inventory`, `@deepseek-ai/dsh-host-apiproxy`, `@deepseek-ai/dsh-api-gateway`, `@deepseek-ai/dsh-typert-registry`. Uninstall refuses them with a new `in-use` code, localized as "in use and cannot be uninstalled here". This is a runtime state, not a category; `include` and `hmr` rows are deliberately excluded — the include root is programmatic (not a patch row) and profile boot recreates a watch-only HMR instance when its row is disabled. The host is the enforcement point; the client does not replicate the guard list.

**Category and description metadata.** The spine rows carry no category or purpose, so `plugin-inventory` owns a read-only `SPINE_META` map keyed by module name (`spine-meta.ts`). `list()` projects optional `category` and `description` onto each inventory entry; an unknown module (a user install, a custom overlay row) projects neither. The 13 category labels share names with the plugin-market taxonomy (`ui`, `security`, `workflow`, `tools`, `session`, `skill`, `model`, …), so the unified filter is one vocabulary.

**Client surface.** The toolbar holds a search box, a category filter menu (each category with its row count, plus all-categories), and the refresh button. The list is grouped by category with a head and count per group; rows without a category land under "Uncategorized". Search matches the module name, the bare entry id, the short name, the category, and the description. Expanding a card reveals a detail panel: status and Cordis status plus module for spine rows, source and install spec plus stars/repository link for catalog rows, and a harness note that a disabled runtime component is reinstalled with Install. The `dsh-managed-` fold now strips the `include:` getter prefix before comparing, so a managed install shows exactly once. Business refusals — including `in-use` — localize from the transport Result instead of surfacing as transport failures.

This note supersedes the [merged-list simplification note](../simplification/2026-08-22-merge-plugin-inventory-sections.md), whose two-face merge is the first half of this decision.

## Alternatives considered

**Keep a separate non-manageable "built-in" class.** Rejected by the user: they asked, verbatim, to manage built-in and external plugins uniformly, and to design the uninstall path properly.

**Allow uninstalling the guard set with a warning.** Rejected: the user chose hard protection. Disabling the manager's own runtime base in-process would orphan the surface that performs the uninstall and the gateway that carries its wire calls; the `in-use` refusal is the only safe answer, and it reads as a runtime fact rather than a category.

**Write category/description onto the bundle patch rows.** Rejected: display metadata does not belong in the deployment composition, and it would need authoring across ~168 rows in the `dsh-base` and `dsh-web-app` layers that already carry the spine. A single read-only map in the inventory keeps authoring in one place and degrades cleanly for unknown modules.

**Fold managed rows by matching the bare `dsh-managed-` prefix.** Rejected after the duplicate-card report: Loader getter ids arrive with an `include:` prefix, so the comparison must strip it first; the fix is a single `bareEntryId` helper used everywhere the ownership marker is compared.

## Testing

Plugin-manager REAL-composition tests boot the loader and drive the gateway: a bundled uninstall writes the disable override, the HMR watcher unmounts the fiber, and the inventory reports `enabled: false`; install lifts the override and remounts; a guard module refuses with `in-use` and leaves the home patch untouched. Plugin-inventory tests pin the `category`/`description` projection from `SPINE_META` and the none-for-unknown-module fallback. Client component tests cover the unified cards, category grouping and the filter menu, the `include:`-prefix fold, and the `in-use` → `errorInUse` localization; the browser-plugin snapshot locks the rendered Settings tab.

## Consequences

Every plugin in the harness — the ~168 spine rows included — is now installable and uninstallable from one surface, grouped by category with detail views. Uninstalling a harness plugin is a persistent disable: the row stays in the home patch, the fiber unmounts, and Install restores it; the operation is fully reversible and idempotent. Five runtime-base modules show an in-use state that cannot be toggled from this surface. The `include:`-prefix fold removes the duplicate cards a managed install previously produced. The read-only `SPINE_META` map is the single authoring home for spine display metadata; the same 13 labels serve the filter menu and the market taxonomy.
