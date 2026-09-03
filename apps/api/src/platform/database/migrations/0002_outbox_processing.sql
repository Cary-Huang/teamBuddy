ALTER TABLE platform.outbox_events
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN claimed_by text,
  ADD COLUMN last_error jsonb,
  ADD COLUMN processed_at timestamptz;

ALTER TABLE platform.outbox_events
  DROP CONSTRAINT outbox_events_status_check,
  ADD CONSTRAINT outbox_events_status_check
    CHECK (status IN ('PENDING', 'PROCESSING', 'FAILED', 'PROCESSED', 'DEAD_LETTER', 'PUBLISHED')),
  ADD CONSTRAINT outbox_events_attempt_count_check
    CHECK (attempt_count >= 0 AND attempt_count <= 5);

CREATE INDEX outbox_events_claim_index
  ON platform.outbox_events (status, available_at, lease_expires_at, occurred_at);
