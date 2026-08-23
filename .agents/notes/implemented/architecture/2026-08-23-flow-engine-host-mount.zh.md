# Agent Note: 在已发布的 Web 宿主面上挂载 flow 引擎

Status: implemented

[English](2026-08-23-flow-engine-host-mount.md) | 中文

## 问题

flow 引擎 `@deepseek-ai/dsh-flow` 已构建并通过测试（compile/validate/run 套件、flow-demo fixture），但从未被任何已发布的组合挂载，Web 组合包甚至把 base 的 `workflow-worker-thread` 行覆盖成 `disabled: true`。于是产品里的 Flow 标签——也就是画布——对每个 `flow.*` RPC 都回答 `flow-unavailable`，只渲染一个只读提示：画布之所以拖不动，是因为它背后根本没有引擎。

## 决策

引擎作为宿主面行加入已发布的 Web 组合。

1. **在 web-app 的 `- insert:` 块里放一行 `flow`** 挂载 `@deepseek-ai/dsh-flow`（`packages/bundle/web-app/cordis.patch.yml`），并移除 web-app 中把 base 的 `workflow-worker-thread` 行禁用的覆盖。`@deepseek-ai/dsh-flow` 加入 `packages/bundle/web-app` 与 `apps/cli` 的依赖，使行解析从组合包与 dsh 应用两处都能找到它。

2. **宿主面所有权。** 引擎留在宿主面：全部八个 `flow.*` RPC 都在 host 上解析 `ctx.get('flowEngine')`，其中六个是 session 无关的。会话自己的 workflow 工具仍来自其 preset 的 `tool-workflow` 行；宿主引擎是另一 realm，而重新启用 `workflow-worker-thread` 增加的是一个宿主服务而不是会话工具，因此已发布的工具目录不变。

3. **行顺序是承载性的。** 引擎在构造时通过 `ctx.get` 解析 `workflowEngine`，缺失即抛 `FLOW_ENGINE_ABSENT`，因此 `flow` 行必须排在 base 的 `workflow-worker-thread` 之后。它放在 `- insert:` 块内，是因为 patch 行必须命中一个既有 id 才会生效——顶层 `- id: flow` patch 会被 `applyEntryPatches` 以"无目标"警告跳过（`vendor/include/src/index.ts`）。插入的行追加在 base 树之后，所以 `flow` 按构造必然排在 base 已启用的 `workflow-worker-thread` 之后。

4. **`./types` 子路径指向真实的运行时模块。** 它原先声明 `default: ./lib/types.js`，这是工作区 tsdown entry glob（`lib/types/{index,invariant,startup}.js`）从不产出的 bundle，因此任何在运行时导入 `@deepseek-ai/dsh-flow/types` 的已构建消费者（api-proxy 的 `FlowRunId`）都会加载失败。该 export 现在镜像仓库约定——`default: ./lib/types/types.js`，即 `lib/types/` 内 tsc 产出的模块——`files` 也改为携带 `lib/types/**/*.js` 而不是那个不存在的 bundle。`FlowId`、`FlowRunId` 与 `FLOW_FORMAT_VERSION` 仍留在 `src/types.ts`，与其它在 types.ts 保留少量运行时常量的包一致。

## 备选方案

- **顶层 `- id: flow` patch 行** —— 被跳过：`applyEntryPatches` 会以警告丢弃 id 无目标的非 insert patch，这正是组合包里所有 Web 专有行都放在 `- insert:` 块里的原因。该行静默地未出现在 loader 条目中时才发现。
- **把 `types` 加进工作区 tsdown entry glob** —— 会给每个包都产出一个 `lib/types.js` bundle，而多数 `src/types.ts` 只有类型，几乎都是空包；因一个消费者而做全仓库改动，予以否决。
- **把 brand 工厂搬出 `types.ts`** —— packages 规则说 `src/types.ts` 应只有类型，但其它包（session、workflow、fs）已经在其中保留少量运行时常量，而且子路径需要的运行时模块已以 tsc 产物的形式存在；无需重新打包。

## 后果

- Flow 标签在已发布的 Web 组合中可用；只读提示仍是省略该引擎的自定义组合的回退。
- `web-agent-presets.e2e.ts` 中过时的 `develop` preset 期望被修正，纳入 develop-mode 洞察特性新增的已发布 preset。
- 没有模型可见输入变化，因此无需快照。
