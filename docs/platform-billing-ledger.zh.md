# 平台计费账本

[English](platform-billing-ledger.md) | 中文

> [platform-capability-market.zh.md](platform-capability-market.zh.md) 的配套文档:计费账本把能力消费按工作区账户计量,并通过结算关闭账期。它是模拟的整数信用点账本——无真实支付——本规范在此规定,落地于 `@deepseek-ai/dsh-experimental-platform-shell` 的 `capability-market` 模块,由 `examples/capability-market-demo/` 无密钥证明。

## 1. 账户

每个工作区持有一个计费账户:一个整数信用点余额(`accounts.workspace_id`、`accounts.balance`)。`creditAccount` 开户或充值,要求 `billing.settle` 平台权限并审计充值。`accountBalance` 在 `billing.read` 权限下读取余额,未开户时返回 `undefined`。

## 2. 费率卡

每条目录条目带一个 `rate`——每消费一单位收取的非负整数信用点(能力属性,D4)。市场工具 `publish_capability` 接受费率,并响亮地拒绝负数或非整数值。一次消费的成本为 `rate × qty`。

## 3. 消费

`consume_capability` 在 `capability.consume` 权限下把一次消费计入工作区账户。它先断言能力的执行门禁已开(见 [platform-capability-market.zh.md](platform-capability-market.zh.md) §4),计算 `cost = rate × qty`,余额不足时以 `INSUFFICIENT_BALANCE` 响亮地拒绝——扣款回滚,不写用量行也不写审计行。成功后扣减账户、记录用量行,并把成本计入当前账期的未结结算。

## 4. 结算

结算以 `open → settled` 状态机关闭一个工作区在某个 `YYYY-MM` 账期的计费。消费累加到该账期的未结结算(工作区首次在某账期消费时以零创建);`settle_account` 在 `billing.settle` 权限下把未结结算翻转为 `settled` 并审计关闭。已结账期即关闭:下一账期的消费开立新的结算。

## 5. 验证

`examples/capability-market-demo/` 无密钥证明账本:操作者给产品工作区充值 100 信用点,产品 agent 的两次消费计量 98 信用点(8 + 90),第三次消费因 `INSUFFICIENT_BALANCE` 被拒且扣款回滚,操作者把两个客户群的账期都结算为 `settled`——全部可从持久化会话日志重建。
