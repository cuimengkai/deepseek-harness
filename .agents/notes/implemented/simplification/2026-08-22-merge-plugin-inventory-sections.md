# Agent Note: Merged the Web Settings plugin inventory and catalog into one list

Status: implemented

English | [中文](2026-08-22-merge-plugin-inventory-sections.zh.md)

## Problem

The Web Settings Plugins tab stacked two separate sections inside one `settings.plugins.tab` contribution (id `all`). An "Installable plugins" section — heading, entry count, refresh button, per-source status lines, and a grid of installable cards — sat above a second "Plugin list" section with its own search box and heading over the Loader inventory cards. The duplicated "plugin list" naming read as if the page listed the same thing twice, and each section's search could not see the other's rows.

## Decision

`ui-settings-plugin-inventory` renders both faces as one list. The section headings and per-section counts are gone; a source-status strip and a toolbar holding the search box and the refresh button sit at the top. Loader inventory rows keep the disclosure-card behavior; catalog entries keep their install/uninstall action with the source badge.

Managed installs are deduplicated: a Loader row whose entry id carries the `dsh-managed-` ownership prefix folds into its catalog card (which shows the installed tag and the uninstall action) instead of appearing twice. The comparison strips the `include:` getter prefix Loader entry ids arrive with, so the fold matches the bare `options.id` the plugin-manager patches use ([topic](../architecture/2026-08-22-live-home-patch-plugin-install.md)).

The tab label becomes "插件"/"Plugins". The removed locale keys (`catalog`, `installable`, `loadingInstallable`, `noInstallable`) are gone from both dictionaries.

This two-face merge is the first half of the [unified plugin manager](../feature/2026-08-23-unified-plugin-manager.md): the follow-on decision groups the same rows by category, adds a category filter, unifies the install/uninstall action across every plugin including the harness spine, and supersedes the surface details in this note.

## Alternatives considered

- Keep the two sections but drop the duplicated heading. Rejected: the user-visible problem was the stacked sections themselves, not the title wording; two grids with separate searches stay harder to scan than one list.
- Put catalog rows above the inventory. Rejected: the mounted host plugins are the primary object of the tab, so installed-first keeps the running state at the top. The follow-on unified-manager decision replaced the fixed ordering with category grouping.
- Add an aria-label to the unified list. Rejected: the single list needs no extra label; tests scope rows by the existing `data-plugin-entry`/`data-catalog-entry` attributes.

## Consequences

- The Plugins tab is one list: source statuses, a search-plus-refresh toolbar, then the Loader and catalog rows. The follow-on unified-manager decision grouped the rows by category with a filter menu and detail panels.
- A catalog read failure shows an inline notice while the Loader rows stay available; the whole-tab failure and retry are reserved for a Loader read failure.
- Empty and no-match states gate on both faces being ready.
- Tests: the merged-list describe covers ordering, `dsh-managed-` folding, one-query filtering across kinds, and the inline catalog failure; assertions on the removed headings and counts were replaced.
