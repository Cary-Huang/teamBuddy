import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const workDatabaseSchema = pgSchema("work");

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const tasks = workDatabaseSchema.table(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    milestoneId: uuid("milestone_id"),
    parentTaskId: uuid("parent_task_id").references(
      (): AnyPgColumn => tasks.id,
    ),
    assigneeId: uuid("assignee_id").notNull(),
    name: text("name").notNull(),
    estimatedHours: numeric("estimated_hours", { mode: "number" }).notNull(),
    remainingHours: numeric("remaining_hours", { mode: "number" }).notNull(),
    status: text("status", {
      enum: ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELED"],
    })
      .default("NOT_STARTED")
      .notNull(),
    manualRank: integer("manual_rank").default(0).notNull(),
    locked: boolean("locked").default(false).notNull(),
    ...auditColumns,
  },
  (table) => [
    check("tasks_estimated_hours_check", sql`${table.estimatedHours} >= 0`),
    check("tasks_remaining_hours_check", sql`${table.remainingHours} >= 0`),
    check("tasks_manual_rank_check", sql`${table.manualRank} >= 0`),
    check(
      "tasks_status_check",
      sql`${table.status} IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELED')`,
    ),
  ],
);

export const taskDependencies = workDatabaseSchema.table(
  "task_dependencies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    predecessorTaskId: uuid("predecessor_task_id")
      .notNull()
      .references(() => tasks.id),
    successorTaskId: uuid("successor_task_id")
      .notNull()
      .references(() => tasks.id),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("task_dependencies_pair_unique").on(
      table.predecessorTaskId,
      table.successorTaskId,
    ),
    check(
      "task_dependencies_not_self_check",
      sql`${table.predecessorTaskId} <> ${table.successorTaskId}`,
    ),
  ],
);

export const workSchemaTables = [tasks, taskDependencies] as const;
