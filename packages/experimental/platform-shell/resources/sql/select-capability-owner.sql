-- The fresh catalog record of the capability whose execution gate governs one
-- tool, for the runtime-enforcement read: never serve a stale gate snapshot.
SELECT c.capability_id, c.name, c.role_id, c.execution, c.version, c.enabled,
       c.rollout, c.rate, c.description, c.created_at
FROM capability_tools AS t
JOIN capabilities AS c ON c.capability_id = t.capability_id
WHERE t.tool_name = ?
LIMIT 1;
