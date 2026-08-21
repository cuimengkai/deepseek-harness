# Platform Billing Ledger

English | [中文](platform-billing-ledger.zh.md)

> Companion to [platform-capability-market.md](platform-capability-market.md): the billing ledger meters capability consumption against per-workspace accounts and closes periods through settlements. It is a simulated integer-credit ledger — no real payment — specified here and realized in the `capability-market` module of `@deepseek-ai/dsh-experimental-platform-shell`, proven keyless by `examples/capability-market-demo/`.

## 1. Accounts

Every workspace holds one billing account: an integer credit balance (`accounts.workspace_id`, `accounts.balance`). `creditAccount` opens or credits an account, requires the `billing.settle` platform permission, and audits the credit. `accountBalance` reads the balance under the `billing.read` permission and returns `undefined` when no account has been opened.

## 2. The rate card

Each catalog entry carries a `rate` — the non-negative integer of credits charged per unit consumed (a capability attribute, D4). The market tool `publish_capability` accepts the rate and refuses a negative or non-integer value loudly. A consumption's cost is `rate × qty`.

## 3. Consumption

`consume_capability` meters one consumption against a workspace account under the `capability.consume` permission. It asserts the capability's execution gate is open (see [platform-capability-market.md](platform-capability-market.md) §4), computes `cost = rate × qty`, and refuses loudly with `INSUFFICIENT_BALANCE` when the balance is short — the debit is rolled back and no usage or audit row is written. On success it debits the account, records a usage row, and accrues the cost into the current period's open settlement.

## 4. Settlement

Settlements close a workspace's billing for one `YYYY-MM` period, as an `open → settled` state machine. Consumption accrues into the period's open settlement, created at zero when a workspace first consumes in a period; `settle_account` flips the open settlement to `settled` under the `billing.settle` permission and audits the close. A settled period is closed: the next period's consumption opens a fresh settlement.

## 5. Verification

`examples/capability-market-demo/` proves the ledger keyless: the operator credits the product workspace 100 credits, the product agent's two consumes meter 98 credits (8 + 90), a third consume refuses on `INSUFFICIENT_BALANCE` with the debit rolled back, and the operator settles both customer groups' periods as `settled` — all reconstructed from the persisted session logs.
