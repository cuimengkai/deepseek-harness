# Agent Note: 项目洞察文档迁移到按类型的 `.dsh/insight/` 布局（formatVersion 2）

Status: implemented

[English](2026-08-24-insight-per-type-layout.md) | 中文

## 问题

开发模式的工作区扫描以单个 `project-insight.json` 文件提交在 `.dsh/` 下。用户诉求——「将扫描到的结果维护在该项目的 .dsh 文件夹下面，根据类型创建对应的文件夹来维护」——要求扫描结果按类型存放在 `.dsh` 下各自对应的文件夹里。单文件还把六个区段耦合在一起：没有消费者能只读一个区段而不解析整个文档，且全文档字节守卫一次作用于所有内容。

## 决策

把磁盘布局拆成 `.dsh/insight/` 下的一个 meta 文件加类型化区段文件，保持内存中的文档与线上词汇不变。实际布局（自共享 documents 内容池起，[[2026-08-26-insight-shared-documents-pool]]）承载七个区段：

```
.dsh/insight/
  meta.json                 # { formatVersion, rootName, contentFingerprint, statSignature, scannedAt }
  tech-stack/data.json
  module-topology/data.json
  component-dependencies/data.json
  components/data.json
  prompts/data.json
  agent-tech/data.json
  documents/data.json
```

- `PROJECT_INSIGHT_FORMAT_VERSION` 从 1 升到 2；按 pre-release 立场，v1 文档被 read 拒绝——无迁移、无兼容。读取器拒绝任何其他版本并报告 `error`；v1 文档会被重新扫描。
- `writeDocument` 先写每个区段文件，再写 meta 文件——meta 写入是读取器可依赖的提交点，因此写入期间的读取观察到的是之前的文档（或无文档），绝不是带缺失区段的新 meta。之后删除遗留的 `.dsh/project-insight.json`。
- `readDocument` 读取 meta（缺失 → `undefined`），拒绝版本错误、超限或无法解析的 meta，读取全部区段文件（任一缺失、超限或损坏 → throw → read 报告 `error`），再重组 `ProjectInsightDoc`。仅 stat 的新鲜度判定不变（[[2026-08-24-read-freshness-stat-signature]]）。
- 常量 `PROJECT_INSIGHT_FILE` 与 `PROJECT_INSIGHT_DOC_REL` 被 `PROJECT_INSIGHT_DIR_REL`（`.dsh/insight`）与 `PROJECT_INSIGHT_META_REL`（`.dsh/insight/meta.json`）取代；服务面向模型的扫描 `path` 现在是 meta 路径，因此 `scan_project` 工具报告 `.dsh/insight/meta.json`。
- `MAX_DOC_BYTES` 从全文档字节守卫变为逐文件守卫；每个存储文件单独设界。
- 区段键 → 文件夹名的映射是布局唯一声明处：`techStack → tech-stack`、`moduleTopology → module-topology`、`componentDependencies → component-dependencies`、`components → components`、`prompts → prompts`、`agentTech → agent-tech`、`documents → documents`。

## 备选方案

- **保留单个 `project-insight.json` 文件**——被否决：不满足按类型分文件夹的诉求，且区段仍耦合在一个字节守卫下。
- **一个 meta 文件内嵌各区段文件名**——被否决：固定目录布局更简单，让消费者可以直接按路径读单个区段，并把类型到文件夹的映射收敛成一个常量。

## 后果

- 一次扫描提交 meta 加每区段一个文件（含 documents 区段共八个文件）；写入中的读取器看到之前的文档或 `none`，绝不会看到半成品，因为 meta 文件最后落盘。
- v1 文档在重新扫描前读作 `error`，遗留文件在首次 v2 写入后消失；两个行为都有 keyless 回归测试覆盖。
- 每个区段的数据可按路径直接读取，单区段读取单独受 `MAX_DOC_BYTES` 设界。
