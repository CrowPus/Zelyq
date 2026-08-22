-- An instance that predates instance roles has no administrator: the column was
-- added with a default of 'member', so the account that set the instance up was
-- silently demoted and nobody could reach settings.
--
-- Promote the earliest account, but only when no administrator exists, so this
-- never overrides a deliberate choice.
UPDATE users SET instance_role = 'admin'
WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.instance_role = 'admin');
