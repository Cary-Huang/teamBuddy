import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const portfolioDatabaseSchema = pgSchema("portfolio");

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const projects = portfolioDatabaseSchema.table(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id").notNull(),
    name: text("name").notNull(),
    priority: text("priority", { enum: ["P0", "P1", "P2", "P3"] }).notNull(),
    targetDate: date("target_date").notNull(),
    ownerMemberId: uuid("owner_member_id"),
    status: text("status", {
      enum: ["PLANNING", "IN_PROGRESS", "PAUSED", "COMPLETED", "CANCELED"],
    })
      .default("PLANNING")
      .notNull(),
    health: text("health", { enum: ["HEALTHY", "AT_RISK", "CRITICAL"] })
      .default("HEALTHY")
      .notNull(),
    healthReason: text("health_reason"),
    ...auditColumns,
  },
  (table) => [
    check(
      "projects_priority_check",
      sql`${table.priority} IN ('P0', 'P1', 'P2', 'P3')`,
    ),
    check(
      "projects_status_check",
      sql`${table.status} IN ('PLANNING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELED')`,
    ),
    check(
      "projects_health_check",
      sql`${table.health} IN ('HEALTHY', 'AT_RISK', 'CRITICAL')`,
    ),
  ],
);

export const milestones = portfolioDatabaseSchema.table(
  "milestones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    targetDate: date("target_date").notNull(),
    manualRank: integer("manual_rank").default(0).notNull(),
    ...auditColumns,
  },
  (table) => [
    check("milestones_manual_rank_check", sql`${table.manualRank} >= 0`),
  ],
);

export const projectTagAssignments = portfolioDatabaseSchema.table(
  "project_tag_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    tagId: uuid("tag_id").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("project_tag_assignments_current_unique")
      .on(table.projectId, table.tagId)
      .where(sql`${table.removedAt} IS NULL`),
    index("project_tag_assignments_project_current_index").on(
      table.projectId,
      table.removedAt,
    ),
    index("project_tag_assignments_tag_history_index").on(
      table.tagId,
      table.assignedAt,
      table.removedAt,
    ),
  ],
);

export const portfolioSchemaTables = [
  projects,
  milestones,
  projectTagAssignments,
] as const;
