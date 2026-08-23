# Agent Note: Live home-patch plugin install over the web Settings surface

Status: implemented

English | [中文](2026-08-22-live-home-patch-plugin-install.zh.md)

## Problem

The web Settings surface has 插件列表 (`ui-settings-plugin-inventory`, a read-only `list` Remote projection of `ctx.loader.entries()`) and 插件配置, but no way to install or uninstall a plugin from the UI. The request was to wire the existing tabs for 在线安装插件 / 在线卸载插件 against a real marketplace: configurable catalog sources (the curated `awesome-dsh-plugin` list and the GitHub `topic:dsh-plugin` search), a manifest layer, real npm network installs, and plugin management.

## Decision

Live hot-reload stays the mechanism. `PluginManagerGateway` (`packages/host/plugin-manager`) registers a `pluginManager` Remote service with four direct verbs — `listAvailable`, `refreshCatalog`, `install`, `uninstall`. Every managed install appends exactly one managed `insert` row to the home-level user patch `$DSH_HOME/cordis.patch.yml` through a locked read-modify-write (`withFileLock` + `writeFileAtomic`, `0o600`/`0o700`); the running Host's config-HMR watcher recomposes and the root Include mounts the fiber without a process restart. The returned install value is a point-in-time snapshot of the committed row — the mount lands asynchronously through HMR, and the console re-reads the inventory to observe the outcome. `uninstall` removes only the rows whose Loader entry id carries the `dsh-managed-` ownership marker and whose module matches the request; user-authored rows, bundle and profile patch layers, and other modules are never touched, with distinct `not-managed` and `not-installed` refusals for the other cases. The service is Remote-only and declares no same-process Cordis `Context` merge; client packages consume it through the explicit `api-remotes` assembly rather than importing the Host implementation.

### Catalog sources

`listAvailable` projects a merged catalog from `Config.sources`, source descriptors composed in order; the shipped default is the awesome curated list plus the GitHub `dsh-plugin` topic search. The `static` kind holds an inline list of locally-resolvable modules — the v1 surface, installed with no network step — and the legacy `catalog` option is accepted and normalized to one `static` source when `sources` is absent. The `awesome` kind fetches the awesome-dsh-plugin repository as its codeload tarball and parses `data/plugins/*.yml` locally; each entry installs by its GitHub `user/repo` spec. The `topic` kind runs a GitHub repository search and is browse-only — a repository is not an installable npm package, so topic entries carry no install action. The `manifest` kind fetches a generic JSON manifest at `url` and is the documented extension point for a private marketplace; each entry's `ref` is the npm install spec, defaulting to the entry `name`. Each network source's parsed manifest caches to `$DSH_HOME/plugins/cache/` under a per-source key with a kind-specific TTL (`topic` 60s, `awesome`/`manifest` one hour) that absorbs the unauthenticated GitHub rate limits; `offline` skips all network fetches and installs and serves only cached and static entries, a stale cache is served on re-fetch failure, one in-flight fetch is shared per source id, and `refreshCatalog` bypasses the cache.

### Network install and uninstall

A network install builds a per-plugin store at `<installPrefix>/node_modules/.dsh-plugins/<slug>/` — an isolated npm project owning a deterministic minimal manifest — and runs the configured package manager (`packageManager`, default `npm`) inside it with `install --legacy-peer-deps --no-audit --no-fund <installRef>` through the injectable `runPackageManager` seam (spawn with a scrubbed parent env and a 120s bound; tests stub it). The resolved package name is read back as the store manifest's single dependency key. The install order is load-bearing: the package must be resolvable before the managed row lands, because config-HMR recompose re-resolves the row's module name at recompose time — install-then-row mounts, row-then-install mounts as `phase: 'failed'`. The resolved name is symlinked into the healed `profiles/node_modules` fallback (`<installPrefix>/node_modules/<name>` → the store's installed copy) and recorded in the provenance ledger `$DSH_HOME/plugins/installed.json` (atomic RMW under the same file lock), then the managed row naming the resolved module is appended so HMR mounts the fiber. A collision with an already-mounted or already-managed resolved module is reported `already-installed` after the package manager ran, with the store rolled back. `uninstall` removes the managed row first (unmounting via HMR), then the symlink, store, and ledger entry. When the user took over the module's row, the store and ledger are kept so the module keeps mounting and the provenance survives, reported as `not-managed`; a cleanup failure after the row is gone returns `remove-failed`, leaving an orphan a retry cleans. `install-failed` carries a diagnostic in `message` (the package-manager stderr tail, or the module-discovery error).

### Peer-sharing through the profiles fallback

`--legacy-peer-deps` skips npm's peer auto-install, so the installed plugin's peer imports (`@deepseek-ai/cordis`, Service Definition packages) resolve at import time by Node's parent walk from the store's installed copy. With the default `installPrefix = $DSH_HOME/profiles`, that walk passes through the `profiles/node_modules` that `healProfilesModuleFallback` maintains — one symlink per package in the app's dependency closure — so every installed plugin shares the Host's single cordis instead of npm installing a duplicate Service instance. Moving `installPrefix` off the default breaks the sharing.

### Managed-row ownership rule

Every managed row is `- insert: [{ id: 'dsh-managed-<slug>', name: '<module>' }]` with `slug = name.replace(/^@/, '').replace(/[^a-z0-9]/gi, '-').toLowerCase()`. The `dsh-managed-` prefix is the ownership marker: `uninstall` matches both the entry id and the module name before removing a row, so a hand-written row for the same name is left in place and reported `not-managed`.

### Not-privileged gating

`pluginManager.*` is deliberately not added to `PRIVILEGED_METHODS`. `trustedHosts` is a DNS-rebinding fence, not authentication; the home patch is user-owned configuration, and a LAN caller already wields equivalent power by hand-editing `cordis.patch.yml` and through the already-unprivileged `agentPreset.*`/`session.create` surface. This now includes the network install path: the configured package manager and the code it installs run on the host with no ecosystem signature verification, so `awesome` — the curated list — is the installable default, `topic` is browse-only, and every install records its exact install spec in the ledger. Installing an unvetted package is the operator's decision; landlock-confinement of the package manager is deferred, matching the unconfined `dsh plugin` pnpm precedent.

## Alternatives considered

**In-memory install with no durable row.** Mounting a fiber directly would give uninstall nothing to remove in a second process and would not survive restart; the home patch is the single source of truth the existing config watcher already watches, so a committed row needs no new lifecycle.

**Restart-required install.** The user chose 热更即时生效 (live hot-reload) over a restart flow, and config-HMR recompose re-resolves a newly added module name at recompose time, so a network-installed package mounts without a restart as long as the package is resolvable before the row lands.

**A plugin store outside the resolution walk.** The store sits inside `profiles/node_modules/.dsh-plugins/` precisely so the installed plugin's parent walk reaches the healed fallback; an isolated store would force npm's peer auto-install (or a hand-maintained peer link set) and pull a duplicate `@deepseek-ai/cordis`.

**Privilege-gating or loopback-pinning the management surface.** The surface manipulates user-owned configuration that a LAN caller can already edit by hand; adding a privilege requirement or pinning the loopback would hide nothing and would break the intended remote control-plane use.

## Consequences

The gateway owns no watcher — it only reads `ctx.loader.entries()`, the ledger, and the home patch under the file lock — so it owns no HMR lifecycle to dispose; the real-composition loader test proves install mount and uninstall disposal through the actual config watcher, for both the static and the store-installed network fixture (the registry-contribution disposal proof). Mutations inside one process are serialized behind a single operation tail; cross-process writers race on the home-patch file lock as before. Managed rows never overwrite user rows. The home-patch rewrite re-serializes through the include's entry-list schema, so hand-written YAML comments in `$DSH_HOME/cordis.patch.yml` are not preserved. Network installs execute third-party code with no signature verification and no version pinning (an awesome/topic entry installs current HEAD); the ledger records the exact install spec, and uninstall removes the store, symlink, and ledger entry together.
