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
} from "drizzle-orm/pg-core";

export const teamDatabaseSchema = pgSchema("team");

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const teams = teamDatabaseSchema.table(
  "teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    defaultDailyHours: numeric("default_daily_hours", { mode: "number" })
      .default(8)
      .notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("teams_name_unique").on(table.name),
    check(
      "teams_default_daily_hours_check",
      sql`${table.defaultDailyHours} >= 0 AND ${table.defaultDailyHours} <= 24`,
    ),
  ],
);

export const members = teamDatabaseSchema.table(
  "members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    name: text("name").notNull(),
    status: text("status", { enum: ["ACTIVE", "INACTIVE"] })
      .default("ACTIVE")
      .notNull(),
    defaultDailyHours: numeric("default_daily_hours", { mode: "number" })
      .default(8)
      .notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("members_team_name_unique").on(table.teamId, table.name),
    check(
      "members_status_check",
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`,
    ),
    check(
      "members_default_daily_hours_check",
      sql`${table.defaultDailyHours} >= 0 AND ${table.defaultDailyHours} <= 24`,
    ),
  ],
);

export const capacityExceptions = teamDatabaseSchema.table(
  "capacity_exceptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    date: date("date").notNull(),
    availableHours: numeric("available_hours", { mode: "number" }).notNull(),
    reason: text("reason"),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("capacity_exceptions_member_date_unique").on(
      table.memberId,
      table.date,
    ),
    check(
      "capacity_exceptions_available_hours_check",
      sql`${table.availableHours} >= 0 AND ${table.availableHours} <= 24`,
    ),
  ],
);

export const teamSchemaTables = [teams, members, capacityExceptions] as const;
