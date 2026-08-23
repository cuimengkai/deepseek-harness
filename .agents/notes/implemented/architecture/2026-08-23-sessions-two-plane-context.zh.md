# Agent Note: Two-plane sessions Context face via subpath isolation

Status: implemented

[English](2026-08-23-sessions-two-plane-context.md) | 中文

## 问题

`@deepseek-ai/dsh-session` 的主入口把 `Context.sessions` 声明为持久的 `SessionStore`——host 的按会话存储面。`@deepseek-ai/dsh-client-runtime` 的主入口把同一键声明为 `ISessions`——客户端的基于 wire 的投影。TypeScript 拒绝合并两个以不同类型声明同一 Context 键的 augmentation（TS2717），只要两个声明模块进入同一 program 就会触发。它们会一起进入，因为客户端文件通过 api remotes 桶转递地 import 了 `@deepseek-ai/dsh-session` 的主入口，于是 host 面泄漏进每个客户端 program，破坏了类型检查。

## 决策

两个面是平面范围的事实，所以隔离也按平面划分。host 的 `Context.sessions: SessionStore` augmentation 从主入口移入新的 `@deepseek-ai/dsh-session/context` 子路径。主入口保留 `Events` augmentation——两个平面都需要它。读取 `ctx.sessions` 作为持久存储的 host 源文件显式 import 该子路径；客户端 program 从不加载它，因此 `ISessions` 仍是客户端平面上唯一的 `sessions` 声明。

模块 augmentation 由 import 驱动：`declare module` 块在其所在模块进入 program 时激活，因此 `import type {} from '@deepseek-ai/dsh-session/context'` 激活该块并在运行时被擦除。包源码在 42 个 host 读取点各带这个 import。host 聚合根 program 里的测试、示例与脚本并不逐个 import 该子路径，因此新增的 `scripts/host-plane.ts` 环境文件——被 host 的 `scripts/**/*.ts` glob 收录、客户端聚合从不引用——为它们程序级激活 host 面。新的需要按平面拆分的 Context 键走同样的两步：为少数面建子路径，为根 program 建 host-plane 环境文件。

## 备选方案

- **统一键类型** —— 合并错误正是"冲突的 augmentation"；`SessionStore` 与 `ISessions` 是契约与所有者都不同的两个东西，一个 Context 键无法同时服务两个平面的类型。
- **改移客户端面** —— `ctx.sessions: ISessions` 是产品被许多客户端包消费的客户端运行时 API；host 面是被远少文件读取的一个持久存储。少数消费方移动。
- **依赖聚合隔离** —— 根 `tsconfig.json` 已经警告 host 与 client 合并永不碰面，但 augmentation 激活跟随 node_modules 的 import 可达性，而非 project reference 成员关系。host augmentation 泄漏进客户端 program，正是因为客户端文件 import 了 session 主入口，所以聚合分离无法约束它。
- **处处改用 `ctx.get('sessions')`** —— 已有一个 host 文件如此读取存储，且它需要 augmentation 才能保持类型化；没有 augmentation 提供键类型时 `ctx.get` 返回 `unknown`。

## 后果

- 客户端 program 只见 `ISessions`；host program 通过显式子路径 import 加 host-plane 环境文件把 `ctx.sessions` 解析为 `SessionStore`。
- `@deepseek-ai/dsh-session/context` 是一个新的公共导出子路径，并在 `tsconfig.base.json` 里配了对应的 paths 项以支持源码级解析。
- 完整的 `pnpm run typecheck`（host 与 client 两个聚合）零 TS2717 通过。
- `Events` augmentation 留在主入口，因为两个平面都需要会话生命周期事件。
