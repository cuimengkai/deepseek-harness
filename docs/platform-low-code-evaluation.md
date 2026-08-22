# Low-Code Direction Evaluation

English | [中文](platform-low-code-evaluation.zh.md)

> Companion to [platform-architecture.md](platform-architecture.md) (§7 Phase 4, D5): this is the Phase 4 evaluation of the low-code direction where users build for users. It takes stock of the validated composable-preset market from Phases 2 and 3, identifies the linchpin gap for a non-engineer assembly path, and records the chosen mechanism.

## 1. Premise

The roadmap's Phase 4 is "evaluate the low-code direction where users build for users." In this product's terms, that means a user of a customer group assembles a workbench — a capability set, a preset binding, and a persona — that other users of the group run, without hand-authoring an agent composition. The roadmap premises the evaluation on the composable-preset market being validated; Phases 2 and 3 delivered that validation ([capability market](platform-capability-market.md), [engine isolation](platform-engine-isolation.md)).

## 2. The assembly unit is already low-code-shaped

A workbench is a scenario bundle: a per-customer-group descriptor naming a capability set, a preset binding, and a persona, published through `publishScenario` and served by `roster.mount`. The market already validates the set — dependency order, version ranges, conflict pairs, and the execution gate refuse loudly and nothing is skipped silently — and billing meters consumption per workspace. What a workbench is, is settled and machine-checked. What is missing is the non-engineer path that produces such a bundle.

## 3. The linchpin gap, now closed

The preset assembler design ([platform-preset-assembler.md](platform-preset-assembler.md)) defines the step that turns a role, a chosen capability set, and context into a runnable preset tree, validated before the roster mounts it. That step was the gap: a workbench reached the roster only through a hand-authored role preset or an operator-driven agent call. The render + validate-before-commit step is now implemented in `@deepseek-ai/dsh-experimental-platform-shell` and proven keyless by the capability-market demo's guided build, in which a non-operator creator agent calls `assemble_preset`, the platform renders and validates the tree, and the host commits the rows to the roster. What still separates a non-engineer from "users build for users" is the descriptor authoring surface, not the assembly mechanism.

## 4. Candidate mechanisms

- **Declarative workbench descriptor.** The user authors or edits the bundle descriptor as data — id, display name, role, preset id, capability ids, per-capability options, persona. The market validates the set, the assembler renders the preset tree, and the roster mounts it. This is low-code in the strict sense: the descriptor, not `cordis.yml` rows, is the authoring unit.
- **Model-guided assembly.** The operator agent in the capability-market demo already builds workbenches through `publish_capability` and `publish_scenario` calls. The model-guided path makes this an interactive build workflow: a user describes the team's needs, the platform agent selects capabilities, runs resolution, and publishes the validated bundle. This is the headless build workflow.
- **Visual builder.** A drag-and-drop workbench builder in the web application. The market spec assigns page rendering to the web-app layer; this mechanism is the largest delta and the natural follow-up once a headless mechanism proves out.

## 5. Gaps that must close

- **Per-capability options** — how a user configures a capability's options without editing the preset rows.
- **A user-side workbench lifecycle** — draft, validate, publish, roll back; `publishScenario` covers registration, not the build workflow around it.
- **The governance boundary** — users assemble, operators publish capabilities; gates, rollout, and billing stay the enforcement points.

## 6. Chosen mechanism

Proceed with the declarative descriptor plus model-guided assembly as the low-code mechanism, and defer the visual builder to the web-app layer. The descriptor and the publish/assemble tools already exist and are keyless-proven; the assembler's render and validate-before-commit step is implemented, and the capability-market demo drives a guided build in which a non-operator creator agent moves from intent to a mounted workbench keylessly. Remaining build blocks are the per-capability options surface and the user-side workbench lifecycle (§5); the governance boundary keeps low-code safe.

## 7. Risks

- C-side real execution remains the high risk from the architecture risk table; curated managed capabilities and the execution gate contain it.
- Governance drift — low-code must let a user assemble, never publish a new capability; the publish path stays operator-only.
- Build scale — the model-guided workflow is the keyless-testable first form; a visual builder changes the presentation, not the mechanism, and adds product scope.
