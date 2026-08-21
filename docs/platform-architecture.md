# Product Architecture: A Multi-Role Collaboration Platform on DeepSeek Harness

English | [中文](platform-architecture.zh.md)

> Status: design draft (v1); date: 2026-08-20; scope: load-bearing decisions, target architecture, multi-tenant topology, security model, data plane and lineage, technical verification points, roadmap and risks; one-line positioning: self-built control plane (multi-tenant shell) + embedded dsh engine; B-side product-engineering-first, C-side capability market later.

---

## 0. Decision Summary

The following are the **load-bearing decisions** locked in this version. They determine the architectural direction, and any change to them triggers cascading rework; avoid changing them before the first paying customer. Each is accompanied by its rationale and optional alternatives.

| # | Decision | This Version | Key Rationale |
|---|---|---|---|
| D1 | Delivery form | **SaaS-hosted first**; enterprise self-hosting reserved as a phase-2 architecture | Fast iteration, direct user feedback; one uniform cross-tenant isolation story |
| D2 | Multi-tenant isolation boundary | **Shared runtime per "workspace"**, tenant physical boundary optional | Horizontally scalable, cost-controlled MVP; isolation semantics come from workspace grouping |
| D3 | Engine embedding | **In-process, with process-out reserved at the interface** | Data plane reachable + permissions injected directly; fastest MVP, can switch to SDK/ACP later |
| D4 | C-side execution depth | **Curated managed capabilities first**; real execution gated per capability | Safe, cost-effective; execution mode becomes a capability attribute |
| D5 | Capability packaging spec | **Reuse dsh plugins + presets + schema'd assets** | The foundation of the ecosystem flywheel; avoid inventing a meta-model |
| D6 | Approval layering | **Business approval (state machine) separate from AI-execution approval (interaction)** | Keeps workflow and permission concerns apart |
| D7 | Data-plane lineage bridge | **Business-object tables ↔ session-log events interlinked through references** | The mechanism behind the core "traceability" selling point |
| D8 | Permission enforcement point | **Enforced at the provider boundary, not the UI layer** | "A role can only see what it should see" cannot rely on UI hiding |

**Product decisions (confirmed by the requester):**
- Delivery form: SaaS-hosted first
- Launch form: B-side product-engineering-first (C-side follows as a natural extension)
- C-side execution depth: curated managed capabilities first

**Explicitly out of scope for this version (to prevent scope creep):**
- No real low-code/self-built application engine (C-side users building apps "for their users") — that is a separate engineering effort, to be evaluated after the composable-preset market is validated.
- No enterprise private deployment in phase one (the deployment topology is reserved in the architecture, but no product/operations support is built).
- No C-side billing/settlement in phase one (the capability-market catalog is built first; billing comes later).

---

## 1. Product Form and Positioning

**One-line positioning: a multi-tenant AI runtime + a capability market + a collaboration control plane.**

- Product-engineering collaboration is the first **flagship capability suite** (a vertical example), not the product itself;
- The platform's "capabilities plug in" mechanism = dsh's plugin/preset mechanism itself, productized as composable, tradable, traceable;
- Different roles (product/UI/development/test) share one asset space and one lineage, each role getting a different tool surface through its preset.

### 1.1 The three role clusters (user profiles)

| Role cluster | Who | Expected capability | Delivery form |
|---|---|---|---|
| Operator | Platform team + capability creators | List capabilities, manage the market, audit | Platform admin console |
| Creator (professional user) | Product-engineering teams, content creators | Assemble capabilities, build scenarios, collaborate | Scenario workbench |
| End user | Students, short-video creators | Achieve goals with pre-assembled capabilities | Lightweight workbench |

### 1.2 Product layers

```
┌─ 场景层(可插拔):  产研一体 | 创作者套件 | 学习助手 ...
│                  每种 = 预设 + 资产schema + 专属桥插件
├─ 能力市场层:      目录 | 依赖/冲突检查 | 版本 | preset装配器 | 计费(二期)
├─ 控制面:         身份/租户/RBAC | 资产仓库+血缘 | 业务审批流 | 审计 | 计费(二期)
├─ 引擎适配层:      角色→preset翻译 | 业务对象↔session log血缘桥 | ACL→provider策略
├─ 运行时:         dsh引擎(agent-loop/subagent/workflow) | 沙箱 | session log
└────────────────────────────────────────────────────────────────────────────
```

---

## 2. Load-Bearing Decisions in Detail

### D1 Delivery form: SaaS-hosted first

- **Decision**: operate one SaaS uniformly; all tenants share the platform code.
- **Architecture reserve**: make "deployment topology" (single-region/multi-region, self-hosted, hybrid) a **config**, not code, driven by `deploymentMode`; future enterprise self-hosting does not rewrite the platform.
- **Rationale**: fastest iteration in the MVP phase and direct real feedback; one uniform cross-tenant isolation story.

### D2 Multi-tenant isolation boundary: shared runtime per "workspace"

- **Decision**: **tenants share one running dsh process tree**, with the **workspace as the isolation unit**. A workspace = a project/team, owning its own role set, asset subspace, and preset bindings.
- **Isolation semantics are decided by workspace grouping**:
  - Each workspace's agent sessions bind to an **independent runtime context** (independent `ctx.agents` instances or independent session domains);
  - Cross-workspace access is rejected by routing policy.
- **Tenant physical boundary is optional**:
  - By default all tenants share one process tree;
  - Tenants needing physical isolation (large accounts/compliance) can be assigned to separate processes/containers.
- **Rationale**: horizontally scalable, cost-controlled MVP; the clean statement "one isolated instance per role" becomes "one group of role sessions per workspace", and the security model is simpler.
- **Risk**: under a shared process, a misbehaving agent in one workspace can affect other workspaces in the same process. Mitigation: the runtime applies per-workspace resource quotas (concurrency, queues, memory) and can split processes on demand.

### D3 Engine embedding: in-process, process-out reserved at the interface

- **Decision**: in the MVP, dsh is assembled **as a library in the same process** (`ctx.plugin(...)`); the engine adapter layer translates role/permission/asset context into preset config in-process and injects it.
- **Process-out reserve**: define **driver interfaces** on the adapter layer (`DriveAgentRun` / `ListSessions` / `ReadLog`) so it can later switch to a standalone dsh process (driven via SDK / ACP).
- **Rationale**: in-process makes the data plane reachable, permissions plug straight into the enforcement point, and the MVP is fastest; process-out (one instance per role/workspace) is the better form for future isolation and upgrade isolation, but costs more.
- **Migration path**: MVP uses in-process → if multi-tenant isolation/stability requirements rise, swap the driver interface for an SDK/ACP process-out implementation.

### D4 C-side execution depth: curated managed capabilities first

- **Decision**: C-side users use **platform-managed capabilities** (generation/analysis/orchestration/retrieval/bridging) and are **not directly exposed** to full `fs`/`subprocess` authority.
- **Execution mode is a capability attribute** (`execution: managed | sandboxed | none`):
  - Default `managed` (platform-scheduled);
  - Specific advanced capabilities (sandbox-verified) may allow `sandboxed` (restricted real execution);
  - Gated per capability on a gray-release basis. **Realized** as a runtime execution gate that re-checks the owning capability's gate state per workspace at `tools/execute` time ([spec](platform-capability-market.md)).
- **Rationale**: safe, cost-effective; dsh's local sandbox (Landlock/bwrap) is a single-machine design, and real code execution under cloud multi-tenancy is hard, so it moves to phase 2.

### D5 Capability packaging spec: reuse dsh plugins + presets + schema'd assets

- **Decision**: a platform capability = **a dsh plugin (tool/service) + a preset (role tool surface) + an asset schema (data shape)** packaged as one unit.
- **Rationale**: the ecosystem flywheel depends on standard packaging; dsh already has a mature plugin model and preset mechanism, so we avoid inventing a meta-model.
- **Interfaces**:
  - Plugins register through `ctx.tools` / `ctx.effect()` / `ctx.waterfall()`;
  - Presets declare the role tool surface through `agent.cordis.yml`;
  - Asset schemas register through merge-extensible registration.

### D6 Approval layering: business approval separate from AI-execution approval

- **Business approval** (project initiation, requirement review, release gate): **the platform control plane builds its own state machine/workflow**, not relying on dsh.
- **AI-execution approval** (an agent about to execute a sensitive operation): use dsh's `interaction`/approval seam, as a layer of execution protection underneath business approval.
- **The two layers chain**: business approval grants → the AI receives an authorized scope → the AI's sensitive operations pass execution approval.

### D7 Data-plane lineage bridge: business objects ↔ session log interlinked

- **The mechanism behind the core "traceability" selling point**.
- AI behavior in the session log can **reference business-object ids**; the business-object tables record lineage relationships.
- So "this code change → implements which requirement → from which PRD version" is traceable across roles, with a **constructive guarantee** (any model-visible input comes from the session log).
- **Mechanism**: write business-object references (id + type + role) into session events, and build a lineage relationship table in the business store.

### D8 Permission enforcement point: enforced at the provider boundary, not the UI layer

- **UI hiding is not permission**. The real enforcement point is the provider boundary:
  - the `fs`/`sandbox` policy seam plugs in your ACL (role → readable/writable paths/workspaces);
  - the approval seam acts as execution protection for AI-sensitive operations;
  - the adapter layer injects ACL semantics into the provider policy.
- **Rationale**: the model holds `fs`/`subprocess` tools directly; the UI layer cannot hide them.

---

## 3. Target Architecture

### 3.1 Five-layer architecture

```
┌──────────────────────────────────────────────────────────────┐
│ 场景层 (可插拔,一期=产研一体)                                    │
│   预设(角色工具面) | 资产schema | 专属桥插件                     │
├──────────────────────────────────────────────────────────────┤
│ 能力市场层                                                      │
│   目录 | 依赖/冲突检查 | 版本 | preset装配器 | 计费(二期)          │
├──────────────────────────────────────────────────────────────┤
│ 控制面                                                          │
│   身份/租户/RBAC | 资产仓库+血缘 | 业务审批流 | 审计 | 计费(二期)  │
├──────────────────────────────────────────────────────────────┤
│ 引擎适配层                                                      │
│   角色→preset翻译 | 业务对象↔session log血缘桥 | ACL→provider策略 │
├──────────────────────────────────────────────────────────────┤
│ 运行时                                                          │
│   dsh引擎 | 沙箱 | session log                                  │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Multi-tenant topology

- Shared runtime + isolation by workspace grouping.
- A workspace holds: role set, asset subspace, preset bindings, member table.
- Optional physical isolation (large accounts/compliance): assigned to separate processes/containers. **Realized** as a per-workspace `isolated` record that routes the drive to a dedicated child engine process ([spec](platform-engine-isolation.md)).

### 3.3 The four data planes

| Data plane | Content | Owned by |
|---|---|---|
| Business-object store (relational) | requirements, assets, approval tickets, roles, workspaces | Platform self-built |
| AI execution log | session log (every AI thought/tool call/output) | dsh |
| Object storage | design-snapshot drafts, large documents | pointer |
| Retrieval index | full-text/vector, for AI RAG | derived (session-query FTS already has a seed) |

**Lineage bridge**: AI behavior in the session log references business-object ids; the business store records lineage relationships → traceable across roles.

### 3.4 Identity and RBAC

- Platform self-built: tenants, members, roles, role-permission mappings.
- Workspace membership decides the visible asset subspace.
- **dsh's identity is untouched** (anonymous single user); platform identity is translated into workspace/role context on the adapter layer.

### 3.5 Capability packaging and assembly

- A capability = a plugin + a preset + an asset schema.
- A user assembles capabilities to taste → the adapter layer renders them into a preset config → mounts it onto the corresponding agent session.
- The capability market provides the catalog, dependency/conflict checks, versions, and the execution gate.

### 3.6 Engine adapter layer responsibilities

- Role → preset translation: translate role + permission + asset context into `agent.cordis.yml`.
- Business-object ↔ session-log lineage bridge: write business-object references, read lineage relationships.
- ACL → provider policy: inject role permissions into the `fs`/`sandbox` policy seam.
- Engine routing (realized): the `EngineDriver` seam resolves each drive by the workspace isolation record — in-process for shared workspaces, process-out for isolated ones, and never silent for an unknown workspace ([spec](platform-engine-isolation.md)).

---

## 4. Security Model

### 4.1 Enforcement points

- **Provider boundary**: the `fs`/`sandbox` policy seam injects the ACL; the `approval` seam protects AI-sensitive operations.
- **Session isolation**: workspace-level; cross-workspace access is rejected by routing policy.
- **Identity**: platform identity is separate from dsh's anonymous identity.

### 4.2 Sandbox

- MVP: C-side = curated managed capabilities, no direct full `fs`/`subprocess` authority; restricted execution uses a sandbox backend (Landlock/bwrap, process-level).
- Phase 2 (if real execution is needed): evaluate cloud sandbox/container isolation.
- **Security baseline**: make "execution mode" a capability attribute and gate it per capability, rather than opening it globally.

### 4.3 Data protection

- Object-storage pointers + permission checks; audit logs record access.
- Read access to the session log is constrained by workspace/role (authorized through the lineage bridge).

---

## 5. Routing Diagram (Phase-1 MVP: product-engineering)

```
            ┌─────────────────────────────────────────────────┐
            │               平台前端(Web)                      │
            │    产品视图 | UI视图 | 开发视图 | 测试视图           │
            └──────────────────────┬──────────────────────────┘
                                   │ HTTP/WS
            ┌──────────────────────▼──────────────────────────┐
            │              平台后端(BFF)                       │
            │  认证/会话 | RBAC | 资产仓库API | 审批流 | 审计     │
            └──────┬───────────────┬───────────────┬──────────┘
                   │               │               │
          ┌────────▼───┐   ┌───────▼───────┐  ┌────▼───────────┐
          │ 业务对象库  │   │ 引擎适配层      │  │ 对象存储/检索    │
          │ 需求/资产/  │   │ 角色→preset    │  │ (指针/索引)      │
          │ 审批/角色   │   │ 血缘桥         │  └────────────────┘
          └────────────┘   │ ACL→provider  │
                           └───────┬───────┘
                          ┌────────▼─────────┐
                          │   dsh 运行时      │
                          │ agent-loop/      │
                          │ subagent/        │
                          │ workflow/        │
                          │ tools(工具面)     │
                          │ session log      │
                          └──────────────────┘
```

**MVP boundary**: use one vertical slice of product-engineering collaboration (requirement → design → development → test → release) to verify the three core mechanisms: "role preset + asset lineage + approval".

---

## 6. Technical Verification Points (must be verified before the architecture lands)

| # | Verification item | Content | Required conclusion |
|---|---|---|---|
| T1 | In-process embedding feasibility | dsh assembled as a library in the backend via `ctx.plugin(...)` | Assemblable, runnable |
| T2 | Preset role tool surfaces | two role presets coexist in one process, each tool surface independent | Passed |
| T3 | Lineage bridge prototype | session log writes business-object ids, traceable across roles | Passed |
| T4 | ACL injected into the provider | inject role ACL into the `fs`/`sandbox` policy, test that unauthorized reads are denied | Passed |
| T5 | Multi-tenant shared process | multiple workspaces share one runtime, resource quotas effective | Passed |
| T6 | Approval seam | after business approval grants, the AI receives the authorized scope; sensitive operations trigger AI approval | Passed |
| T7 | Capability market assembly | user assembles capabilities to taste → rendered into a preset config → takes effect | Passed |
| T8 | On-demand physical isolation + process-out | an isolated workspace's drive runs in a dedicated child engine process with per-workspace store and log roots; shared stays in-process; store separation and log reconstructability verified | Passed |

---

## 7. Roadmap (four phases)

### Phase 1 (MVP: verify the core mechanisms)
- Platform shell: login/tenant/RBAC, asset store (+ lineage), business approval flows, audit.
- Engine adapter layer: dsh in-process embedding, role→preset, lineage bridge, ACL→provider.
- Product-engineering scenario: one vertical slice of requirement→design→development→test→release.
- Capability market: a catalog seed (preset assembly, no billing).

### Phase 2 (extend to C-side self-assembly) — realized as experimental prototypes
- Complete the capability market: dependency/conflict checks, versions, billing/settlement ([spec](platform-capability-market.md), [billing](platform-billing-ledger.md)).
- C-side lightweight workbench: users assemble capabilities to taste through scenario bundles served per customer group.
- Restricted execution (gated per capability on a gray-release basis): a registered runtime gate re-checks each tool's owning capability's gate state per workspace at `tools/execute` time and refuses `CAPABILITY_DISABLED` ([spec](platform-capability-market.md)).

### Phase 3 (scale and isolation upgrade) — realized as experimental prototypes
- On-demand physical isolation (large accounts/compliance): a workspace's `isolated` record routes its agent drive to a dedicated child engine process; container/VM isolation remains a backend swap on the same seam ([spec](platform-engine-isolation.md), [package](../packages/experimental/engine-isolation/README.md)).
- Engine process-out: the `EngineDriver` seam (`drive`/`listSessions`/`readLog`) with an in-process runner and a process-out child engine; session persistence is file-backed and process-agnostic, so the parent reads the child's durable logs ([keyless demo](../examples/engine-isolation-demo/README.md)).

### Phase 4 (evaluate low-code)
- After the composable-preset market is validated, evaluate the low-code direction where "users build for users".

---

## 8. Risk List

| Risk | Level | Mitigation |
|---|---|---|
| Preview dependency: dsh makes no stable-API promise, `SESSION_FORMAT_VERSION` is always 0 | High | Pin versions; fork if necessary; use an adapter layer in the design to isolate dsh changes; `terminator` branch sync strategy |
| Cloud multi-tenant execution + sandbox security (C-side real execution) | High | C-side curated managed capabilities first; real execution in phase 2; process-level Landlock/bwrap sandbox |
| Workspaces affecting each other under a shared process | Medium | Resource quotas; split processes on demand |
| Asset-governance depth (versions/relations/permissions/lifecycle) | Medium | Phase 1 does "pointer + relation" only, no file movement |
| Permission enforcement not thorough ("a role can only see what it should see") | High | Enforcement point pushed down to the provider boundary; verified by T4 |
| Cross-role collaboration coordination (real-time editing of design drafts/documents) | Low | No real-time collaboration in phase 1; use "separate tracks + artifact handoff" |

---

## 9. Development Conventions and Follow-ups

- Repo conventions: follow `AGENTS.md` and `docs/AGENTS.md`; non-trivial changes carry an Agent Note.
- This document is the **single authority** for the product/platform architecture draft; a load-bearing-decision change requires updating this document and a review.
- Follow-ups: preset-assembler design ([platform-preset-assembler.md](platform-preset-assembler.md)), asset-schema spec ([platform-asset-schema.md](platform-asset-schema.md)), lineage-bridge data model ([platform-lineage-bridge.md](platform-lineage-bridge.md)), approval-flow state machine ([platform-approval-state-machine.md](platform-approval-state-machine.md)), capability-market meta-model ([platform-capability-market.md](platform-capability-market.md)), billing ledger ([platform-billing-ledger.md](platform-billing-ledger.md)).

---

## 10. Appendix: Mapping of the dsh capabilities this relies on

| Capability | dsh counterpart |
|---|---|
| AI execution engine | `agent-loop`, `subagent`, `workflow`, `jobs` |
| Traceability (core selling point) | session log + `session-query` (lineage/events/full-text) |
| Role tool surface | `preset` (`agent.cordis.yml`) |
| Approval (AI-sensitive operations) | `interaction` (approval/ask-user) |
| Asset-schema registration | merge-extensible storage/domain forms |
| Sandbox | `sandbox` (Landlock/bwrap/Seatbelt) |
| Remote/external capabilities | `subagent-acp` (ACP), `hooks` (bridging), SDK |
