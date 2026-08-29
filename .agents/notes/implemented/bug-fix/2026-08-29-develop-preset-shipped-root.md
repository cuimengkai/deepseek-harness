# Agent Note: Develop preset rejoined the shipped roster after the master merge

Status: implemented

English | [中文](2026-08-29-develop-preset-shipped-root.zh.md)

## Problem

The five develop-mode insight tabs (module topology, component dependencies, tech stack, components, agent tech) never rendered: `filterViewTabs` gates them to `modes: ['develop']`, but no root supplies a `develop` preset anymore. The branch had authored the preset at `apps/cli/config/agent-presets/develop/` and fed it through a launcher-side overlay in `composeProfile` (`SHIPPED_PRESET_ROOT` pushed into the `agent-presets` row's `roots`). The merge reconciliation adopted master's `profile-boot.ts`, which carries no launcher patching — master's f94495e527 had moved shipped presets into the package and deleted that mechanism — so the branch's develop preset sat in a directory nothing scans, while its `config/agent-presets` tree stayed on disk unreferenced.

## Decision

Follow master's architecture rather than resurrect the launcher patch: `git mv` the preset into `packages/preset/agent-presets/presets/develop/`, where `includeShippedRoot` (schema default true) discovers it with `system` trust, first-root-wins, and the `presets/` entry already ships it in the package tarball. The web e2e's `SHIPPED_PRESETS` constant now points at the package's shipped root, and `shipped-root.spec.ts` asserts the five-id set. `verify-cordis-config` reports the same `workflow-worker-thread` plane complaint for develop as for standard/ptc/cordis — the pre-existing baseline class, not a new violation.

## Verification

`packages/preset/agent-presets`: 170 tests passed, including the updated shipped-set assertion (develop listed, system-trusted, not malformed); `tsc -b`, `oxlint`, and `verify-cordis-config` stay at their pre-change baselines. The running web service re-reads the shipped root per roster call, so a restart brings the preset back without a rebuild.

## Consequences

- The develop preset appears in every roster again; a session running it shows the five insight tabs, and `autoScanPresets` (default `['develop']`) resumes workspace scanning.
- Shipped presets now live only inside `dsh-agent-presets/presets/`; `apps/cli/config/agent-presets` is gone, and a future preset is added to the package, never to a launcher-fed directory.
