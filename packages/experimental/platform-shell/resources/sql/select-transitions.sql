SELECT ticket_id, seq, from_status, to_status, actor_user_id, created_at FROM approval_transitions WHERE ticket_id = ? ORDER BY seq;
