SELECT ticket_id, workspace_id, subject_kind, subject_id, status, actor_user_id, review_scope, created_at, updated_at
FROM approval_tickets WHERE workspace_id = ? ORDER BY ticket_id;
