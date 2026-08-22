SELECT capability_id, name, role_id, execution, version, enabled, rollout, rate, description, rows, created_at
FROM capabilities WHERE capability_id = ?;
