SELECT event_id, actor_user_id, workspace_id, action, target_kind, target_id, detail, created_at
FROM audit_events WHERE action = ? ORDER BY event_id;
