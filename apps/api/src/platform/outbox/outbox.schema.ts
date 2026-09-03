import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const platformDatabaseSchema = pgSchema("platform");

export const outboxEvents = platformDatabaseSchema.table(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    type: text("type").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    aggregateId: uuid("aggregate_id"),
    payload: jsonb("payload").notNull(),
    status: text("status", {
      enum: [
        "PENDING",
        "PROCESSING",
        "FAILED",
        "PROCESSED",
        "DEAD_LETTER",
        "PUBLISHED",
      ],
    })
      .default("PENDING")
      .notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    claimToken: uuid("claim_token"),
    lastError: jsonb("last_error"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("outbox_events_event_id_unique").on(table.eventId),
    uniqueIndex("outbox_events_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    check(
      "outbox_events_status_check",
      sql`${table.status} IN ('PENDING', 'PROCESSING', 'FAILED', 'PROCESSED', 'DEAD_LETTER', 'PUBLISHED')`,
    ),
    check(
      "outbox_events_attempt_count_check",
      sql`${table.attemptCount} >= 0 AND ${table.attemptCount} <= 5`,
    ),
    index("outbox_events_claim_index").on(
      table.status,
      table.availableAt,
      table.leaseExpiresAt,
      table.occurredAt,
    ),
    index("outbox_events_claim_token_index").on(
      table.id,
      table.claimedBy,
      table.claimToken,
      table.leaseExpiresAt,
    ),
  ],
);

export const outboxSchemaTables = [outboxEvents] as const;
