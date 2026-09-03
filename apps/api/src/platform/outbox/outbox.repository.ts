import { eq, or } from "drizzle-orm";

import type { DbTransaction } from "../database/client.js";
import { outboxEvents } from "./outbox.schema.js";

export interface OutboxEvent {
  eventId: string;
  idempotencyKey?: string;
  type: string;
  correlationId: string;
  aggregateId?: string;
  payload: unknown;
  occurredAt: string;
}

export interface OutboxRepository {
  append(tx: DbTransaction, event: OutboxEvent): Promise<void>;
}

export class DrizzleOutboxRepository implements OutboxRepository {
  async append(tx: DbTransaction, event: OutboxEvent): Promise<void> {
    const idempotencyKey = event.idempotencyKey ?? event.eventId;
    const occurredAt = new Date(event.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new TypeError(`Invalid Outbox occurredAt: ${event.occurredAt}`);
    }

    const inserted = await tx
      .insert(outboxEvents)
      .values({
        eventId: event.eventId,
        idempotencyKey,
        type: event.type,
        correlationId: event.correlationId,
        aggregateId: event.aggregateId,
        payload: event.payload,
        occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: outboxEvents.id });
    if (inserted.length > 0) return;

    const conflicts = await tx
      .select()
      .from(outboxEvents)
      .where(
        or(
          eq(outboxEvents.eventId, event.eventId),
          eq(outboxEvents.idempotencyKey, idempotencyKey),
        ),
      );
    if (
      conflicts.length === 1 &&
      conflicts[0] &&
      outboxEventsMatch(conflicts[0], event, idempotencyKey, occurredAt)
    ) {
      return;
    }

    throw new OutboxEventConflictError(event.eventId, idempotencyKey);
  }
}

type OutboxEventRow = typeof outboxEvents.$inferSelect;

const outboxEventsMatch = (
  persisted: OutboxEventRow,
  event: OutboxEvent,
  idempotencyKey: string,
  occurredAt: Date,
): boolean =>
  persisted.eventId === event.eventId &&
  persisted.idempotencyKey === idempotencyKey &&
  persisted.type === event.type &&
  persisted.correlationId === event.correlationId &&
  persisted.aggregateId === (event.aggregateId ?? null) &&
  persisted.occurredAt.toISOString() === occurredAt.toISOString() &&
  canonicalJson(persisted.payload) === canonicalJson(event.payload);

const canonicalJson = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Outbox payload must be JSON serializable");
  }
  return JSON.stringify(sortJsonValue(JSON.parse(serialized)));
};

const sortJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJsonValue(child)]),
    );
  }
  return value;
};

export class OutboxEventConflictError extends Error {
  readonly name = "OutboxEventConflictError";
  readonly code = "OUTBOX_EVENT_CONFLICT";

  constructor(
    readonly eventId: string,
    readonly idempotencyKey: string,
  ) {
    super(
      `Outbox event ${eventId} conflicts with idempotency key ${idempotencyKey}`,
    );
  }
}
