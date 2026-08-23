# Agent Note: Plugin-catalog security hardening: list-time filtering, install containment, and client caching

Status: implemented

English | [中文](2026-08-23-plugin-catalog-security-hardening.zh.md)

## Problem

The unified plugin manager shipped live install/uninstall, but three gaps remained against the user's safety-first mandate — invalid and unproven catalog entries are eliminated at list-display time, safety is the first priority, and install and uninstall must be thorough. Topic entries were browse-only, because a GitHub repository is not an installable npm package; the console could show but never install them. Every tab mount and every refresh re-read the whole catalog, because there was no client cache and no push; the console hit the Remotes repeatedly. And a network install ran the package manager and the package's lifecycle scripts on the host with no signature verification and no sandbox, which the user said was an unaffordable risk — installing an unsafe plugin must not poison the host.

## Decision

Phase A hardening ships six seams, all documented on the plugin-manager README and changeable from `cordis.yml`. The honest boundary stays on the record: plugin code still executes inside the Host process, so process-level runtime isolation is a later phase; this phase contains the install step, records provenance, and requires an explicit trust confirmation.

### List-time validation and filtering

A server-side policy module (`src/validator.ts`) gates every non-`static` catalog entry both when a snapshot is built and inside `findInstallable`, so the console cannot bypass list filtering by calling install on a name the list already dropped. Every entry first passes a syntax gate: `topic`/`awesome` names must be `owner/repo`-shaped, and a `manifest` entry's `installRef` must be a safe npm spec on an allowlist that refuses `file:` and the other local-path schemes outright. Then `topic` (always) and opt-in `awesome` entries probe npm-installability through the GitHub contents API — a root `package.json` with a valid, non-`private` name is `installable`, a 404 is `not-installable`, and rate limits and server errors are `unknown`. `not-installable` and `unknown` (unprobed, rate-limited, budget-exhausted) entries are dropped at list time, never shown browse-only; offline sources skip the probe and keep their entries browse-only so an offline console still sees its cache. Verdicts persist in `$DSH_HOME/plugins/cache/probes.json` with a freshness TTL, the probe budget (default 10) bounds how many uncached repos one pass may probe, and GitHub's anonymous rate limit is absorbed by the 15-minute topic cache and the verdict cache. Each source reports how many entries it dropped through `filteredCount` on `PluginManagerCatalogSourceStatus`, so the console shows that filtering happened instead of silently hiding entries.

### Install-time containment

`installArgv` appends `--ignore-scripts` by default and redirects npm's cache into the per-plugin store directory, so the uninstall deletes the cache with the store. When `installSandbox` (default `true`) is set, the package-manager invocation runs under the OS sandbox with a `workspace-write` file policy scoped to the store; when it is enabled but no backend is usable the install is refused with `sandbox-unavailable` and the package manager never runs unconfined. Lifecycle scripts run only when the deployment sets `allowInstallScripts` AND the request sets `allowScripts: true`, both defaulting off. The shipped sandbox backends do not restrict network, so `--ignore-scripts` and the trust gate carry the script and exfiltration risk; the sandbox bounds the file blast radius of a hostile package during the install step.

### Integrity ledger

The provenance ledger record gains `version` and npm `integrity`, read from the store's `package-lock.json` after a successful install. `verifyStoreIntegrity` re-reads the lockfile and reports `ok`, `tampered`, or `missing`; a tampered installed entry carries an integrity warning in the catalog snapshot and a tampered badge in the console, and `uninstall` verifies before removal but still deletes the store completely — a suspected-tampered plugin is exactly the one that must be removed.

### Explicit trust confirmation, host-enforced

`PluginManagerInstallRequest` gains a required `confirmed: boolean`. A network install whose request lacks `confirmed: true` is refused with `confirmation-required` when `requireInstallConfirmation` (default `true`) is set; the check is host-side, so bypassing the console still hits it. The catalog snapshot carries a `capabilities` block — `networkConfirmation`, `allowInstallScripts`, and `installSandbox` as `confined`/`unconfined`/`unavailable` — so the console renders exactly the trust surface the deployment permits. The trust dialog shows the module, the exact install spec, the source kind, and the repository URL, states that the action installs and runs third-party code with lifecycle scripts disabled by default, and gates Install behind an acknowledgement; it offers the scripts opt-in only when the deployment advertises it, and disables Install when the deployment cannot confine.

### Client caching and event forwarding

The `api-remotes` allowlist adds `plugin-inventory/changed` and `plugin-manager/catalog-changed`, so the Host forwarding loop relays them to clients. The plugin-inventory gateway coalesces one frame of Loader lifecycle events (`loader/entry-init`, `loader/partial-dispose`, `internal/plugin`, `internal/status`) into a single microtask emit and only emits when the recomputed projection actually differs from the last one sent, so `internal/status` fiber transitions do not flood the wire with no-op nudges; the plugin-manager emits at each committed install/uninstall and each `refreshCatalog`. The inventory tab keeps one snapshot per face in a store that survives tab remounts, subscribes to the forwarded events, and refetches a face only while the tab has a live subscriber — an event that arrives while unmounted marks the cached snapshot stale so the next mount refetches it instead of serving an outdated view. A `connection/reset` forces a full reload, because the cached snapshots belong to the previous Host process.

### Topic TTL

The `topic` cache TTL drops from 60 s to 15 minutes so the topic search and the npm-installability probes fit inside GitHub's anonymous budget (roughly 60 requests an hour); `cacheTtlMs` overrides it globally, and `validationProbeBudget` tunes probe frequency.

## Alternatives considered

**Filtering in the UI instead of at the wire.** The user's instruction was explicit that invalid and unproven entries are eliminated at list-display time, safety first; a UI filter could be bypassed by a direct Remote call, so the gate lives server-side and `findInstallable` applies the same gate.

**`npm view user/repo` as the installability probe.** It clones the repository, is slow, and burns the anonymous budget on transport rather than a single contents fetch; reading the root `package.json` through the GitHub contents API is one request and one base64 decode.

**A sandbox that also restricts network.** The shipped sandbox backends (bwrap, landlock, seatbelt, Windows ACL) do not restrict network by policy; building a net namespace is out of scope, so `--ignore-scripts` plus the trust gate carry the script and exfiltration risk, and the sandbox bounds the file surface of a hostile package during the install step.

**Blocking network installs outright.** The user wanted install to work securely, not to disappear; the containment, ledger, and explicit confirmation keep the path while making the risk explicit and the defaults safe.

**Client polling for catalog changes.** Polling spends a Remote read per interval per mounted console; the forwarded events converge on pushed Host changes, cost nothing while unmounted, and mark stale instead.

**Runtime isolation in this phase.** A subprocess plugin host is the real fix for a malicious plugin's runtime code, but it is a large architecture phase; this note records it as the next phase rather than shipping an in-process gate that JavaScript evaluation cannot honestly enforce.

## Consequences

The dropped-entry rule is server-side, so an entry the list removed cannot be installed by a direct call — the console cannot be bypassed. Network installs cannot run lifecycle scripts by default and cannot run unconfined while `installSandbox` is on; a missing backend refuses the install rather than running npm naked. The ledger detects local drift at the store level, not a compromised upstream registry or a swapped published tarball. The host-enforced confirmation makes the trust decision explicit and console-bypass-proof. The client caches both faces and converges on pushed events only while mounted, so reselecting the tab no longer re-reads both Remotes. The costs: GitHub rate limits bound the probe budget, so an unprobed repo is dropped rather than shown browse-only except for offline sources; an operator who sets `installSandbox: false` or `requireInstallConfirmation: false` takes over the risk the defaults carry; and community plugin code still runs in-process until the subprocess plugin host lands.
