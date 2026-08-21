# Approval Flow State Machine

[中文](platform-approval-state-machine.zh.md) | English

> Companion to [platform-architecture.md](platform-architecture.md) (D6): business approval (the platform's self-built state machine) and AI-execution approval (the `interaction` seam) are two layers, chained — business approval grants an authorization scope, and sensitive AI operations pass through execution approval inside that scope. This spec models both, grounded in `examples/platform-agent-demo/`.

## 1. Two layers, one chain

| Layer | Owns | Mechanized by | Demo surface |
|---|---|---|---|
| Business approval | project gates: intake, requirement review, release | the platform's own state machine | out of the demo's scope |
| AI-execution approval | a sensitive operation a running agent wants to execute | the `dsh-user-approval` seam | `approval/asked` → `approval/decided` |

The chain is: business approval passes → the agent holds an authorization scope → a sensitive operation inside that scope still crosses execution approval.

## 2. Business approval state machine

A business artifact (requirement, release) moves through states owned by the platform control plane:

```
draft → review → approved → released
          ↓
        rejected → draft
```

Transitions are the platform's own records, not dsh events. A business approval grants a **scope**: which roles, which capabilities, which workspace, valid until a point. The scope is handed to the agent as part of its execution context.

## 3. AI-execution approval states

The `interaction` seam's approval is a short-lived, per-request decision:

```
requested → asked → decided (allowed-once | rejected | cancelled | unavailable)
```

The answerer is a waterfall listener on `approval/request`; without one, the request fails closed to `unavailable`. `allowed-once` grants exactly one execution — the retried write in the prototype is the live example.

## 4. Chaining in the prototype

The dev agent's out-of-workspace write is the walk-through:

1. The write is denied by the fs sandbox (`FS_SANDBOX_DENIED`) — the provider boundary enforces the workspace scope before approval is even involved.
2. The model retries with `sandbox_permissions: danger-full-access` and a justification — this is the escalation advertisement the denial carried.
3. The escalation routes through `ctx.approval` (`approval/request`), the scripted answerer grants `allowed-once`, and the write executes.

In a real platform, step 1's scope would come from business approval (§2); the demo hard-codes the dev role's `workspace-write` scope and lets the prototype prove the execution-approval layer in isolation.

## 5. Durable audit

The `approval/asked` and `approval/decided` pair is a session event, so it lands in the session log and is durable and replayable. The prototype asserts `approvalEnforcement.auditPairPersisted` against the persisted JSONL. Business-approval transitions are the platform's own records; the two audit trails are reconciled by the lineage bridge when both name the same business object.

## 6. Verification

The prototype proves the execution-approval layer keyless: denial → escalation → `allowed-once` → execution, with the durable audit pair. This spec's additions are the business state machine, the scope-granting transition, and the two-layer chain — the D6 follow-up in §9.
