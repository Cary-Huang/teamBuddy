import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const taxonomyDatabaseSchema = pgSchema("taxonomy");

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const tagGroups = taxonomyDatabaseSchema.table(
  "tag_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    selectionMode: text("selection_mode", { enum: ["SINGLE", "MULTIPLE"] })
      .default("MULTIPLE")
      .notNull(),
    scope: text("scope", { enum: ["PROJECT", "TASK", "BOTH"] })
      .default("PROJECT")
      .notNull(),
    requiredOnProject: boolean("required_on_project").default(false).notNull(),
    status: text("status", { enum: ["ACTIVE", "ARCHIVED"] })
      .default("ACTIVE")
      .notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("tag_groups_team_code_unique").on(table.teamId, table.code),
    index("tag_groups_team_status_order_index").on(
      table.teamId,
      table.status,
      table.displayOrder,
    ),
    check(
      "tag_groups_selection_mode_check",
      sql`${table.selectionMode} IN ('SINGLE', 'MULTIPLE')`,
    ),
    check(
      "tag_groups_scope_check",
      sql`${table.scope} IN ('PROJECT', 'TASK', 'BOTH')`,
    ),
    check(
      "tag_groups_status_check",
      sql`${table.status} IN ('ACTIVE', 'ARCHIVED')`,
    ),
    check("tag_groups_display_order_check", sql`${table.displayOrder} >= 0`),
  ],
);

export const tags = taxonomyDatabaseSchema.table(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id").notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => tagGroups.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    color: text("color").default("#2563eb").notNull(),
    description: text("description"),
    status: text("status", { enum: ["ACTIVE", "ARCHIVED"] })
      .default("ACTIVE")
      .notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("tags_team_code_unique").on(table.teamId, table.code),
    uniqueIndex("tags_group_name_unique").on(table.groupId, table.name),
    index("tags_team_group_status_order_index").on(
      table.teamId,
      table.groupId,
      table.status,
      table.displayOrder,
    ),
    check("tags_color_check", sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`),
    check("tags_status_check", sql`${table.status} IN ('ACTIVE', 'ARCHIVED')`),
    check("tags_display_order_check", sql`${table.displayOrder} >= 0`),
  ],
);

export const taxonomySchemaTables = [tagGroups, tags] as const;
