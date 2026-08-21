SELECT asset_id, parent_id, role_id, created_at FROM lineage WHERE asset_id = ? ORDER BY parent_id;
