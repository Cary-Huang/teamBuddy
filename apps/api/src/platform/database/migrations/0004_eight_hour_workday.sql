ALTER TABLE team.teams
  ALTER COLUMN default_daily_hours SET DEFAULT 8;

ALTER TABLE team.members
  ALTER COLUMN default_daily_hours SET DEFAULT 8;

UPDATE team.teams
SET default_daily_hours = 8,
    updated_at = now()
WHERE default_daily_hours = 6;

UPDATE team.members
SET default_daily_hours = 8,
    updated_at = now()
WHERE default_daily_hours = 6;
