# Agent Note: 读取新鲜度改由仅 stat 签名判定；内容指纹仅在扫描时计算

Status: implemented

[English](2026-08-24-read-freshness-stat-signature.md) | 中文

## 问题

`readDocument` 在每次读取时都重算内容指纹来回答 fresh 还是 stale：一次受限行走加对每个已行走文件的有界内容读取（对排序后的 `(relativePath, size, content)` 三元组做 sha256）。工作台每 2000 ms 轮询一次 `projectInsight.read`，并在每次切换标签时也读取，因此每次轮询都会重读至多 `MAX_FINGERPRINT_FILES`（5000）个文件的字节。「每次切换都在扫描」的观感正是这条读取路径的开销——自动扫描本身早已按根去抖且单飞。

## 决策

把树的身份拆成两个，把廉价的那个放到读取路径上。

- `statProject`（walk.ts）行走相同的受限集合，但只哈希 stat 投影——排序后的 `rel\0size\0mtimeMs` 行，不读内容——得到 `{ maxMtime, count, signature }` 结果。`mtimeMs` 与 `size` 一起来自 walk 本就会做的同一次 `stat`，零额外开销。
- `readDocument` 把存储的 `statSignature` 与刚算出的 stat 签名比较；相等 → fresh，否则 stale。在 `statSignature` 出现前提交的文档没有该字段，因此读作 stale 并被重新扫描一次。
- 内容指纹保留，但只在扫描时：`scanProject` 同时计算并存储 `contentFingerprint` 与 `statSignature`，fresh-no-op（unchanged-skip）去重现在走廉价的 stat 签名。
- `projectContentFingerprint` 从包表面移除——它的唯一生产调用方是 `readDocument`；内容身份通过 `fingerprintOf`（scanner 内部）与 `doc.contentFingerprint` 可达。
- 线上的镜像同步更新：host apiproxy 的 `projectInsightDocSchema` 增加 `statSignature`，三个 `ProjectInsightDoc` fixture（apiproxy spec、ui-project-insight store spec、connection fixture）补上该字段。

## 备选方案

- **读取路径上保留内容指纹**——被否决：读内容正是要移除的开销；仅受限行走（stat，不读字节）才是廉价的判定基础。
- **仅凭 `maxMtime` 判定陈旧**——被否决：单一 mtime 无法探测新增或删除的文件（其 mtime 可能早于树的最大值），因此需要逐文件签名。

## 后果

- `read`（轮询或切换标签）只行走树、绝不读文件字节；内容指纹仅在扫描运行时重算。
- 同尺寸同 mtime 的内容编辑在下一次扫描前读成 fresh——stat 签名对它失明。扫描时重算的内容指纹是兜底，该局限已记入包 README。
- `statProject` 返回 `maxMtime` 与 `count` 作为身份元数据；当前无消费者比较它们，它们服务于诊断与回归测试。
