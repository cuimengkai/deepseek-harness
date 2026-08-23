# Agent Note: Two-plane sessions Context face via subpath isolation

Status: implemented

English | [中文](2026-08-23-sessions-two-plane-context.zh.md)

## Problem

`@deepseek-ai/dsh-session`'s main index augmented `Context.sessions` as the durable `SessionStore` — the host's per-session store face. `@deepseek-ai/dsh-client-runtime`'s main index augments the same key as `ISessions` — the client's wire-backed projection. TypeScript refuses to merge two Context augmentations that type the same key differently (TS2717), and it fires whenever both augmenting modules land in one program. They land together because client files transitively import `@deepseek-ai/dsh-session`'s main index through the api remotes barrel, so the host face leaked into every client program and broke the typecheck.

## Decision

The two faces are plane-scoped facts, so the isolation is plane-scoped. The host's `Context.sessions: SessionStore` augmentation moved out of the main index into a new `@deepseek-ai/dsh-session/context` subpath. The main index keeps the `Events` augmentation, which both planes need. Host source files that read `ctx.sessions` as the durable store import the subpath explicitly; client programs never load it, so `ISessions` stays the only `sessions` declaration on the client plane.

Module augmentation is import-driven: a `declare module` block activates when its containing module is in the program, so `import type {} from '@deepseek-ai/dsh-session/context'` activates the block and is erased at runtime. Package src carries that import at each of the 42 host read sites. Tests, examples, and scripts in the host aggregate's root program do not import the subpath per-file, so a new `scripts/host-plane.ts` ambient — included by the host `scripts/**/*.ts` glob, never named by the client aggregate — activates the host face for them program-wide. A new Context key that is plane-split follows the same two steps: a subpath for the minority face, and a host-plane ambient for the root program.

## Alternatives considered

- **Unify the key type** — the merge error is exactly "conflicting augmentations"; `SessionStore` and `ISessions` are different contracts with different owners, and one Context key cannot serve both planes' typing at once.
- **Move the client face instead** — `ctx.sessions: ISessions` is the product's client runtime API consumed across many client packages; the host face is one durable store read by far fewer files. The minority consumer moves.
- **Rely on aggregate isolation** — the root `tsconfig.json` already warns that the host and client merges never meet, but augmentation activation follows node_modules import-reachability, not project-reference membership. The host augmentation leaked into the client program precisely because client files import the session main index, so aggregate separation cannot contain it.
- **Require `ctx.get('sessions')` everywhere** — one host file already reads the store this way and needed the augmentation to stay typed; without an augmentation providing the key, `ctx.get` returns `unknown`.

## Consequences

- Client programs see only `ISessions`; host programs resolve `ctx.sessions` to `SessionStore` through explicit subpath imports plus the host-plane ambient.
- `@deepseek-ai/dsh-session/context` is a new public export subpath, with a matching `tsconfig.base.json` paths entry for source-level resolution.
- The full `pnpm run typecheck` (host and client aggregates) passes with zero TS2717.
- The `Events` augmentation stays in the main index because session lifecycle events are needed by both planes.
