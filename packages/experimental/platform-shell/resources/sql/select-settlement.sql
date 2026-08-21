SELECT settlement_id, workspace_id, period, amount, status, created_at, settled_at
FROM settlements WHERE settlement_id = ?;
