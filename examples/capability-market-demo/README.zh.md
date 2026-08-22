# capability-market-demo

[English](README.md) | 中文

一个无密钥可运行的证明,覆盖 [docs/platform-capability-market.md](../../docs/platform-capability-market.zh.md) 中的能力市场与 [docs/platform-billing-ledger.md](../../docs/platform-billing-ledger.zh.md) 中的计费账本,构建在 [@deepseek-ai/dsh-experimental-platform-shell](../../packages/experimental/platform-shell/README.zh.md) 的平台控制面之上。五个 agent 共享同一个 harness 进程:`market-operator` 发布目录并关闭计费账期,`product` agent 装配产品工程工作台并计量消费,`video` agent 用自带能力集装配短视频创作工作台,`market-creator` agent 驱动引导式预设装配,`market-content` agent 挂载装配出的预设。无需 `DEEPSEEK_API_KEY`,无需网络:`market-demo` 模型 provider 是进程内脚本化 adapter,demo 退出时清理自己的临时存储与 session 日志。

## 运行

```sh
node --import tsx/esm examples/capability-market-demo/src/demo.ts
```

驱动脚本启动宿主装配,创建两个客户群工作区,为每个 agent 各驱动一条多轮链,然后打印一份证明各机制的 JSON 摘要。

## 它证明了什么

- **一个目录服务三个工作台。** 操作者发布十二个带依赖、冲突、版本、执行与费率属性的能力;三个场景捆绑注册 product-engineering、short-video-creation 与 content-marketing 工作台,能力集互不相交(`workbenches.heterogeneous`)。
- **装配响亮地拒绝,修复后恢复解析。** 装配 `test-execution` 依依赖优先顺序解析传递链(`code-analysis → test-case-generation → test-execution`);冲突对以 `CAPABILITY_CONFLICT` 拒绝,版本范围不匹配以 `VERSION_MISMATCH` 拒绝,重新发布修复后的范围即恢复解析(`assembly.note`)。
- **执行门禁在装配与调用两处都拒绝。** 装配期:禁用依赖以 `CAPABILITY_DISABLED` 拒绝到达它的装配,灰度 0 的能力拒绝每个工作区,把灰度开到 1 后重新接纳。运行期:同一个 `analyze_code` 调用在 `code-analysis` 启用时被放行,操作者在回合之间禁用它后以 `CAPABILITY_DISABLED` 被拒——注册的运行时门禁在 `tools/execute` 时按工作区重新检查实时门禁状态(`gating`)。
- **工作台是按群组的绑定。** 每个客户群的工作台返回自己的能力集与预设 id,`roster.mount` 把每个 agent 的作用域链绑定到它——`workbenches.rosterMount` 显示 `product-engineering`、`short-video-creation` 与装配出的 `content-marketing`(被提供的是场景捆绑描述符;页面渲染属于 Web 应用层)。
- **装配器在提交前渲染并校验一棵工作台树。** 创建者 agent 在 content-marketing 工作台上调用 `assemble_preset`;渲染出的树按目录顺序携带角色基底加每个已选能力的 persona 行,平台禁用行被报告(`assembly.report.disabledOnPlatform`),同样的请求在重渲染时产出深度相等的行(`determinism`)。重复的行 id 与被遮蔽的工具名各自响亮拒绝,因此两棵树都无法到达 roster(`rejections`)。宿主通过 `AgentPresets.write` 提交渲染出的行,roster 在其上挂载一个新 agent;组合后的系统提示词按目录顺序携带基础 persona 与每个能力 persona,减去禁用行(`mounted`)。
- **计费账本计量并结算。** 产品工作区充值 100 信用点,两次消费计量 98(8 + 90),第三次消费因 `INSUFFICIENT_BALANCE` 被拒且扣款回滚,操作者把两个账期都结算为 `settled`(`billing`)。
- **模型可见 ⟺ 已记录。** 每个市场工具的 `presentationMeta` code 落在持久化的 `tool/result` 事件里(`traceability.metaCodes`),两个工作台 agent 看到同样的市场工具表面(`traceability.uniformlyVisible`)。
- **悬空依赖边不可能存在。** 卸载被其他能力依赖的能力会被外键链拒绝(`catalog.canNotOrphan`),这正是 `CAPABILITY_DEPENDENCY_MISSING` 无法经由服务到达的原因;最近的可达拒绝——被门禁关掉的依赖——以 `CAPABILITY_DISABLED` 触发。

## 结构

各文件职责:`cordis.yml` 是宿主装配,`presets/platform-admin/`、`presets/product-engineering/` 与 `presets/short-video-creation/` 是纯人设预设,`src/demo.ts` 驱动五个 agent(包括引导式构建、经 `AgentPresets.write` 的提交与挂载后 agent 的断言)并断言证据,`src/mock-llm.ts` 是脚本化无密钥模型 adapter,`src/capability-market-demo.ts` 用 demo 的 session→用户绑定注册市场工具(含装配器的 `resolveBaseRows`),把 session 绑定到工作区,并注册运行时执行门禁;`src/persona-row.ts` 是装配能力预设行所指向的 demo 自有、可按节配置的 persona 行。

```
cordis.yml
presets/platform-admin/
presets/product-engineering/
presets/short-video-creation/
src/demo.ts
src/mock-llm.ts
src/capability-market-demo.ts
src/persona-row.ts
```

## 真实运行

把 agent `provider` 从 `market-demo` 换成 `deepseek-official`,挂载 `dsh-llm-deepseek`(在 `cordis.yml` 里禁用),并提供 `DEEPSEEK_API_KEY`,即可用真实模型运行同一装配。
