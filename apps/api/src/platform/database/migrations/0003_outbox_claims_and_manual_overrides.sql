ALTER TABLE platform.outbox_events
  ADD COLUMN claim_token uuid;

ALTER TABLE planning.schedule_allocations
  DROP CONSTRAINT schedule_allocations_version_task_member_date_unique,
  ADD CONSTRAINT schedule_allocations_version_task_member_date_source_unique
    UNIQUE (schedule_version_id, task_id, member_id, date, source);

CREATE INDEX outbox_events_claim_token_index
  ON platform.outbox_events (id, claimed_by, claim_token, lease_expires_at);

CREATE TABLE planning.task_allocation_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  task_id uuid NOT NULL,
  member_id uuid NOT NULL,
  date date NOT NULL,
  hours numeric NOT NULL,
  locked boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_allocation_overrides_team_task_member_date_unique
    UNIQUE (team_id, task_id, member_id, date),
  CONSTRAINT task_allocation_overrides_hours_check CHECK (hours > 0 AND hours <= 24),
  CONSTRAINT task_allocation_overrides_locked_check CHECK (locked)
);
