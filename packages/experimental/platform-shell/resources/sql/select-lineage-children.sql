SELECT asset_id, parent_id, role_id, created_at FROM lineage WHERE parent_id = ? ORDER BY asset_id;
