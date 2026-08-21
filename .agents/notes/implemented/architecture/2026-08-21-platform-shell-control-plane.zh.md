# Agent Note: 以实验性包形式加入平台控制面

Status: implemented

[English](2026-08-21-platform-shell-control-plane.md) | 中文

## 问题

平台架构文档([D1-D8](../../../../docs/platform-architecture.zh.md))锁定了自建控制面的决策:租户/RBAC、业务对象资产存储、其血缘、业务审批流程与审计日志,全部落在一个 SQLite 数据库上。兄弟 `platform-agent-demo` 用内存存储与 fs/shell 表面上的角色隔离证明了 T1-T7,但没有包拥有持久控制面记录或其上方的模型可见工具。计划增量要求一个实验性包加一个无密钥示例,带 `product`、`dev`、`qa` 三个角色预设。

## 决策

`packages/experimental/platform-shell` 是私有仅源码实验性包:一个 SQLite 文件上的 `ctx.platformShell` 服务、十个模型可见工具与血缘桥不变量伴生。`examples/platform-shell-demo` 通过五个 agent 无密钥驱动完整表面。该包遵守常规实验性包要求——`private: true`、无 `publishConfig`、绝不成为发布包的运行时依赖——且不产出构建后的 `lib/`,因此 demo 在 tsx ESM hook 下通过 `./src/*` 导出加载源码入口。

demo 预设**纯人设**:每个角色预设只挂载区分该角色的 persona,不挂任何 fs 或 shell 工具。fs/shell 角色隔离已由兄弟 `platform-agent-demo` 证明;在此重复只是复制已证明的表面,不带来证据收益。这就是相对计划中 `{product, dev, qa}` 名册的偏差。

计划命名了三个角色;demo 播种第四个角色 `platform-admin`。审批状态机把 `approve` 与 `release` 拆开,两个决策点必须能由不同 actor 行使——product 角色驱动 `draft → review → approved` 并持有审批范围,再由独立的 platform-admin release 到 `approved → released`。把两个决策都授予一个角色会混淆审批者与放行者,并让 release 边无人驱动。因此存储的 `DEFAULT_ROLES` 播种 `product`、`dev`、`qa` 与 `platform-admin`,与 demo 预设一致;RBAC 强制留在服务边界(D8),demo 的裸 `mallory` agent 证明已注册的非成员在任何存储访问前就被拒绝。

## 备选方案

**把 `approval.release` 授予 `qa` 角色。** QA 的只读验证 persona 不携带放行业务对象的权限;用它做 release 会把验证与授权混为一谈。

**由 demo 驱动脚本直接执行 release 边。** demo 的目的是证明 agent 驱动控制面,因此 release 必须经过角色 agent,而不是宿主侧的存储调用。

**在本 demo 中重复 fs/shell 角色隔离。** 兄弟 demo 已用沙箱化工作区栅栏与工具集差异证明该表面;重复只会增加运行时成本与证据噪音,而控制面的访问边界是服务层的 RBAC,不是工具挂载。

## Consequences

控制面位于一个私有、仅源码、无发布包依赖的实验包中,因此其记录类型与事件不属于发布的 SDK。纯人设预设让 demo 免于重复兄弟 `platform-agent-demo` 已证明的 fs/shell 隔离;服务边界的 RBAC 是唯一被强制的访问墙。包不发布构建产物 `lib/`,因此消费方通过 tsx ESM hook 下的 `./src/*` 导出加载它。
