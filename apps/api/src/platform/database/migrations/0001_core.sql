CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS team;
CREATE SCHEMA IF NOT EXISTS portfolio;
CREATE SCHEMA IF NOT EXISTS work;
CREATE SCHEMA IF NOT EXISTS planning;
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE team.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL,
  default_daily_hours numeric NOT NULL DEFAULT 6,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_name_unique UNIQUE (name),
  CONSTRAINT teams_default_daily_hours_check
    CHECK (default_daily_hours >= 0 AND default_daily_hours <= 24)
);

CREATE TABLE team.members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES team.teams(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  default_daily_hours numeric NOT NULL DEFAULT 6,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT members_team_name_unique UNIQUE (team_id, name),
  CONSTRAINT members_status_check CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT members_default_daily_hours_check
    CHECK (default_daily_hours >= 0 AND default_daily_hours <= 24)
);

CREATE TABLE team.capacity_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES team.members(id),
  date date NOT NULL,
  available_hours numeric NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capacity_exceptions_member_date_unique UNIQUE (member_id, date),
  CONSTRAINT capacity_exceptions_available_hours_check
    CHECK (available_hours >= 0 AND available_hours <= 24)
);

CREATE TABLE portfolio.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  name text NOT NULL,
  priority text NOT NULL,
  target_date date NOT NULL,
  owner_member_id uuid,
  status text NOT NULL DEFAULT 'PLANNING',
  health text NOT NULL DEFAULT 'HEALTHY',
  health_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_priority_check CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  CONSTRAINT projects_status_check
    CHECK (status IN ('PLANNING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELED')),
  CONSTRAINT projects_health_check CHECK (health IN ('HEALTHY', 'AT_RISK', 'CRITICAL'))
);

CREATE TABLE portfolio.milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES portfolio.projects(id),
  name text NOT NULL,
  target_date date NOT NULL,
  manual_rank integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT milestones_manual_rank_check CHECK (manual_rank >= 0)
);

CREATE TABLE work.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  milestone_id uuid,
  parent_task_id uuid REFERENCES work.tasks(id),
  assignee_id uuid NOT NULL,
  name text NOT NULL,
  estimated_hours numeric NOT NULL,
  remaining_hours numeric NOT NULL,
  status text NOT NULL DEFAULT 'NOT_STARTED',
  manual_rank integer NOT NULL DEFAULT 0,
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_estimated_hours_check CHECK (estimated_hours >= 0),
  CONSTRAINT tasks_remaining_hours_check CHECK (remaining_hours >= 0),
  CONSTRAINT tasks_manual_rank_check CHECK (manual_rank >= 0),
  CONSTRAINT tasks_status_check
    CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELED'))
);

CREATE TABLE work.task_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  predecessor_task_id uuid NOT NULL REFERENCES work.tasks(id),
  successor_task_id uuid NOT NULL REFERENCES work.tasks(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_dependencies_pair_unique
    UNIQUE (predecessor_task_id, successor_task_id),
  CONSTRAINT task_dependencies_not_self_check
    CHECK (predecessor_task_id <> successor_task_id)
);

CREATE TABLE planning.schedule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  source_event_id uuid NOT NULL,
  result_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_versions_source_event_unique UNIQUE (source_event_id),
  CONSTRAINT schedule_versions_result_fingerprint_check
    CHECK (char_length(result_fingerprint) = 64),
  CONSTRAINT schedule_versions_status_check CHECK (status = 'DRAFT')
);

CREATE TABLE planning.schedule_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_version_id uuid NOT NULL REFERENCES planning.schedule_versions(id),
  task_id uuid NOT NULL,
  member_id uuid NOT NULL,
  date date NOT NULL,
  hours numeric NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_allocations_version_task_member_date_unique
    UNIQUE (schedule_version_id, task_id, member_id, date),
  CONSTRAINT schedule_allocations_hours_check CHECK (hours > 0 AND hours <= 24),
  CONSTRAINT schedule_allocations_source_check CHECK (source IN ('AUTOMATIC', 'MANUAL'))
);

CREATE TABLE platform.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  type text NOT NULL,
  correlation_id uuid NOT NULL,
  aggregate_id uuid,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_events_event_id_unique UNIQUE (event_id),
  CONSTRAINT outbox_events_idempotency_key_unique UNIQUE (idempotency_key),
  CONSTRAINT outbox_events_status_check CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED'))
);
