import { sql } from "drizzle-orm";
import {
  check,
  date,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";

export const planningDatabaseSchema = pgSchema("planning");

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const scheduleVersions = planningDatabaseSchema.table(
  "schedule_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id").notNull(),
    sourceEventId: uuid("source_event_id").notNull(),
    resultFingerprint: text("result_fingerprint").notNull(),
    status: text("status", { enum: ["DRAFT"] })
      .default("DRAFT")
      .notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("schedule_versions_source_event_unique").on(
      table.sourceEventId,
    ),
    check("schedule_versions_status_check", sql`${table.status} = 'DRAFT'`),
    check(
      "schedule_versions_result_fingerprint_check",
      sql`char_length(${table.resultFingerprint}) = 64`,
    ),
  ],
);

export const scheduleAllocations = planningDatabaseSchema.table(
  "schedule_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scheduleVersionId: uuid("schedule_version_id")
      .notNull()
      .references(() => scheduleVersions.id),
    taskId: uuid("task_id").notNull(),
    memberId: uuid("member_id").notNull(),
    date: date("date").notNull(),
    hours: numeric("hours", { mode: "number" }).notNull(),
    source: text("source", { enum: ["AUTOMATIC", "MANUAL"] }).notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex(
      "schedule_allocations_version_task_member_date_source_unique",
    ).on(
      table.scheduleVersionId,
      table.taskId,
      table.memberId,
      table.date,
      table.source,
    ),
    check(
      "schedule_allocations_hours_check",
      sql`${table.hours} > 0 AND ${table.hours} <= 24`,
    ),
    check(
      "schedule_allocations_source_check",
      sql`${table.source} IN ('AUTOMATIC', 'MANUAL')`,
    ),
  ],
);

export const taskAllocationOverrides = planningDatabaseSchema.table(
  "task_allocation_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id").notNull(),
    taskId: uuid("task_id").notNull(),
    memberId: uuid("member_id").notNull(),
    date: date("date").notNull(),
    hours: numeric("hours", { mode: "number" }).notNull(),
    locked: boolean("locked").default(true).notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("task_allocation_overrides_team_task_member_date_unique").on(
      table.teamId,
      table.taskId,
      table.memberId,
      table.date,
    ),
    check(
      "task_allocation_overrides_hours_check",
      sql`${table.hours} > 0 AND ${table.hours} <= 24`,
    ),
    check("task_allocation_overrides_locked_check", sql`${table.locked}`),
  ],
);

export const planningSchemaTables = [
  scheduleVersions,
  scheduleAllocations,
  taskAllocationOverrides,
] as const;
