# Agent Note: Web boot creates entries sequentially

Status: implemented

English | [中文](2026-08-23-web-boot-sequential-creates.zh.md)

## Problem

`AppWebEntry.runPluginBoot` created every loader row in parallel. A consumer row created while its provider's service fiber was still loading went PENDING, and `loader.await()` skips PENDING entries (they carry no inertia), so the activation audit then rejected the whole boot. Adding the ui-router row — a provider that ui-layout and ui-settings-general strict-inject — made the race deterministic enough to hit: `web boot: 4 entries did not activate`, with ui-layout and ui-settings-general pending for `router` and ui-sidebar and ui-conversation pending for `layout`. The "a provider's service resolves before its consumers start" assumption held only by timing.

## Decision

**Creates run in manifest order, one at a time.** The manifest is topologically sorted — a row's providers precede its consumers — so sequential creates let a provider's service settle before the next consumer row starts; the ordering the composition already declares becomes real instead of timing-dependent. The loader is then awaited to quiescence before the activation audit.

**A provider row's apply awaits its own service.** An entry that mounts a service other rows inject stays LOADING until that service's fiber is ACTIVE (`await ctx.plugin(RouterService)`), because the loader considers a row loaded once its entry fiber settles — an entry that activated before its service is exactly the PENDING race. Consumers strict-resolve the service, and a boot that omits the provider leaves them PENDING and fails the audit loud with the waiting service names.

## Alternatives considered

- **Keep parallel creates and re-await PENDING entries** — `loader.await()` skipping PENDING is the loader contract; re-awaiting them re-introduces the race and adds machinery for a few dozen rows. Sequential creates remove the timing gap at its source.
- **Make consumers lazy (`ctx.get`) instead of strict inject** — weakens the provider/consumer contract and defers a missing service to first use; strict inject plus sequential creates keeps the boot deterministic and the audit loud.
- **Rely on the loader's own dependency ordering** — the loader resolves cross-row injects when it can; the race is specifically a create-time window that ordering alone does not close.

## Consequences

- Boot is deterministic: a provider's service settles before its consumers are created, and the audit reports only real activation failures. Sequential cost is negligible for a few dozen rows.
- The pattern is now a requirement: any function-plugin `apply` that mounts a service other rows inject should await that service fiber, so the entry's settling is a true readiness signal.
- A composition that forgets a needed provider row fails the audit with the waiting service names — loud and self-explanatory.
- The surrounding boot glue — prefetch-before-create, module adoption, the activation audit — is owned by [the web config-tree boot note](2026-07-24-web-config-tree-boot-and-transport-layering.md); this note refines how the graph rows are created within that flow. The ui-router provider it protects is [the routed settings page's router](2026-08-23-routed-settings-page.md).
