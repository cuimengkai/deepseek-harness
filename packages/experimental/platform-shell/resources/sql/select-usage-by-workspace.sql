SELECT usage_id, workspace_id, capability_id, qty, cost, billed_at, created_at
FROM usage_records WHERE workspace_id = ? ORDER BY created_at, usage_id;
