SELECT m.role_id AS role_id, r.display_name AS role_name
FROM members m
JOIN roles r ON r.role_id = m.role_id
WHERE m.user_id = ? AND m.workspace_id = ?;
