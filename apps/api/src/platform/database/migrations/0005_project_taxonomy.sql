CREATE SCHEMA IF NOT EXISTS taxonomy;

CREATE TABLE taxonomy.tag_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  selection_mode text NOT NULL DEFAULT 'MULTIPLE',
  scope text NOT NULL DEFAULT 'PROJECT',
  required_on_project boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tag_groups_team_code_unique UNIQUE (team_id, code),
  CONSTRAINT tag_groups_selection_mode_check CHECK (selection_mode IN ('SINGLE', 'MULTIPLE')),
  CONSTRAINT tag_groups_scope_check CHECK (scope IN ('PROJECT', 'TASK', 'BOTH')),
  CONSTRAINT tag_groups_status_check CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT tag_groups_display_order_check CHECK (display_order >= 0)
);

CREATE TABLE taxonomy.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  group_id uuid NOT NULL REFERENCES taxonomy.tag_groups(id),
  code text NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#2563eb',
  description text,
  status text NOT NULL DEFAULT 'ACTIVE',
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_team_code_unique UNIQUE (team_id, code),
  CONSTRAINT tags_group_name_unique UNIQUE (group_id, name),
  CONSTRAINT tags_color_check CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT tags_status_check CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT tags_display_order_check CHECK (display_order >= 0)
);

CREATE TABLE portfolio.project_tag_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES portfolio.projects(id),
  tag_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX project_tag_assignments_current_unique
  ON portfolio.project_tag_assignments (project_id, tag_id)
  WHERE removed_at IS NULL;
CREATE INDEX project_tag_assignments_project_current_index
  ON portfolio.project_tag_assignments (project_id, removed_at);
CREATE INDEX project_tag_assignments_tag_history_index
  ON portfolio.project_tag_assignments (tag_id, assigned_at, removed_at);
CREATE INDEX tag_groups_team_status_order_index
  ON taxonomy.tag_groups (team_id, status, display_order);
CREATE INDEX tags_team_group_status_order_index
  ON taxonomy.tags (team_id, group_id, status, display_order);
CREATE INDEX projects_team_status_target_date_index
  ON portfolio.projects (team_id, status, target_date);

INSERT INTO taxonomy.tag_groups
  (team_id, code, name, selection_mode, scope, required_on_project, display_order)
SELECT id, 'project_source', '项目来源', 'SINGLE', 'PROJECT', false, 10
FROM team.teams
ON CONFLICT (team_id, code) DO NOTHING;

INSERT INTO taxonomy.tag_groups
  (team_id, code, name, selection_mode, scope, required_on_project, display_order)
SELECT id, 'work_type', '工作类型', 'SINGLE', 'BOTH', false, 20
FROM team.teams
ON CONFLICT (team_id, code) DO NOTHING;

INSERT INTO taxonomy.tags
  (team_id, group_id, code, name, color, display_order)
SELECT groups.team_id, groups.id, defaults.code, defaults.name, defaults.color, defaults.display_order
FROM taxonomy.tag_groups groups
JOIN (
  VALUES
    ('project_source', 'fulfillment', '履约', '#7c3aed', 10),
    ('work_type', 'product_iteration', '产品迭代', '#2563eb', 10),
    ('work_type', 'technical_improvement', '技术改造', '#0891b2', 20),
    ('work_type', 'bugfix', 'Bugfix', '#dc2626', 30)
) AS defaults(group_code, code, name, color, display_order)
  ON defaults.group_code = groups.code
ON CONFLICT (team_id, code) DO NOTHING;

INSERT INTO portfolio.project_tag_assignments (team_id, project_id, tag_id)
SELECT projects.team_id, projects.id, tags.id
FROM portfolio.projects projects
JOIN taxonomy.tags tags
  ON tags.team_id = projects.team_id AND tags.code = 'fulfillment'
WHERE projects.name ILIKE '%履约%'
ON CONFLICT DO NOTHING;
