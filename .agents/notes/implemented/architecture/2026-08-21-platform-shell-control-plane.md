# Agent Note: Add the platform control plane as an experimental package

Status: implemented

English | [中文](2026-08-21-platform-shell-control-plane.zh.md)

## Problem

The platform-architecture doc ([D1-D8](../../../../docs/platform-architecture.md)) locks the decisions for a self-built control plane: tenant/RBAC, a business-object asset store, its lineage, a business-approval flow, and an audit log over one SQLite database. The sibling `platform-agent-demo` proved T1-T7 with an in-memory store and role isolation over the fs/shell surface, but no package owned the durable control-plane records or the model-visible tools over them. The planned increment called for one experimental package plus a keyless example, with `product`, `dev`, and `qa` role presets.

## Decision

`packages/experimental/platform-shell` is a private source-only experimental package: the `ctx.platformShell` service over one SQLite file, ten model-visible tools, and the lineage-bridge invariant companion. `examples/platform-shell-demo` drives the full surface keylessly through five agents. The package follows the ordinary experimental-package requirements — `private: true`, no `publishConfig`, never depended on by release packages — and ships no built `lib/`, so the demo loads it through the `./src/*` export under the tsx ESM hook.

The demo presets are **persona-only**: each role preset mounts only the persona that distinguishes it, with no fs or shell tools. The fs/shell role isolation is already proven by the sibling `platform-agent-demo`; repeating it here would duplicate proven surface for no evidence gain. This is the deviation from the plan's `{product, dev, qa}` roster.

The plan named three roles; the demo seeds a fourth, `platform-admin`. The approval state machine splits `approve` from `release`, and the two decision points must be exercisable by distinct actors — the product role drives `draft → review → approved` and holds the review scope, then a separate platform-admin releases `approved → released`. Granting both decisions to one role would conflate the approver and the releaser and leave the release edge undriven. The store's `DEFAULT_ROLES` therefore seed `product`, `dev`, `qa`, and `platform-admin`, matching the demo presets; RBAC enforcement stays at the service boundary (D8), and the demo's bare `mallory` agent proves that a registered non-member is denied before any store access.

## Alternatives considered

**Grant `approval.release` to the `qa` role.** QA's read-only verification persona carries no authority to release business objects; reusing it for release conflates verification with authorization.

**Drive the release edge from the demo driver directly.** The demo's purpose is to prove agents drive the control plane, so the release must go through a role agent, not a host-side store call.

**Repeat the fs/shell role isolation in this demo.** The sibling demo already proves that surface with sandboxed workspace fences and tool-set differences; duplicating it adds runtime cost and evidence noise, and the control plane's access boundary is RBAC at the service layer, not tool mounting.
