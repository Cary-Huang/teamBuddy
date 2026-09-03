import type { Sql } from "postgres";

export interface WorkerLogger {
  info(message: string, context: Record<string, unknown>): void;
  error(message: string, context: Record<string, unknown>): void;
  warn?(message: string, context: Record<string, unknown>): void;
}

export interface ClaimedOutboxEvent {
  id: string;
  eventId: string;
  type: string;
  correlationId: string;
  aggregateId: string | null;
  payload: unknown;
  attemptCount: number;
  claimedBy: string;
  claimToken: string;
}

export type OutboxHandler = (event: ClaimedOutboxEvent) => Promise<void>;

const RETRY_DELAYS_SECONDS = [5, 30, 120, 600, 1800] as const;

export class OutboxPoller {
  constructor(
    private readonly sql: Sql,
    private readonly handler: OutboxHandler,
    private readonly logger: WorkerLogger,
    private readonly workerId: string,
  ) {
    if (workerId.length === 0) throw new TypeError("workerId is required");
  }

  claimBatch(): Promise<ClaimedOutboxEvent[]> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<ClaimedOutboxEvent[]>`
        WITH claimable AS (
          SELECT id, gen_random_uuid() AS claim_token
          FROM platform.outbox_events
          WHERE (
              status IN ('PENDING', 'FAILED')
              AND available_at <= clock_timestamp()
            ) OR (
              status = 'PROCESSING'
              AND lease_expires_at <= clock_timestamp()
            )
          ORDER BY occurred_at, event_id
          FOR UPDATE SKIP LOCKED
          LIMIT 20
        )
        UPDATE platform.outbox_events AS event
        SET
          status = 'PROCESSING',
          claimed_by = ${this.workerId},
          claim_token = claimable.claim_token,
          lease_expires_at = clock_timestamp() + interval '60 seconds',
          updated_at = clock_timestamp()
        FROM claimable
        WHERE event.id = claimable.id
        RETURNING
          event.id,
          event.event_id AS "eventId",
          event.type,
          event.correlation_id AS "correlationId",
          event.aggregate_id AS "aggregateId",
          event.payload,
          event.attempt_count AS "attemptCount",
          event.claimed_by AS "claimedBy"
          , event.claim_token AS "claimToken"
      `;
      return [...rows];
    });
  }

  async markProcessed(event: ClaimedOutboxEvent): Promise<void> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE platform.outbox_events
      SET
        status = 'PROCESSED',
        processed_at = clock_timestamp(),
        published_at = clock_timestamp(),
        lease_expires_at = NULL,
        claimed_by = NULL,
        claim_token = NULL,
        last_error = NULL,
        updated_at = clock_timestamp()
      WHERE id = ${event.id}
        AND status = 'PROCESSING'
        AND claimed_by = ${this.workerId}
        AND claim_token = ${event.claimToken}
        AND lease_expires_at > clock_timestamp()
      RETURNING id
    `;
    if (rows.length === 0) throw new LostOutboxClaimError(event.eventId);
    this.logger.info("Outbox event processed", {
      eventId: event.eventId,
      correlationId: event.correlationId,
      workerId: this.workerId,
    });
  }

  async markFailed(event: ClaimedOutboxEvent, error: unknown): Promise<void> {
    const attemptCount = event.attemptCount + 1;
    const deadLetter = attemptCount >= RETRY_DELAYS_SECONDS.length;
    const delaySeconds = RETRY_DELAYS_SECONDS[Math.min(attemptCount - 1, 4)];
    const structuredError = serializeError(error, event.correlationId);
    const rows = await this.sql<{ id: string }[]>`
      WITH failure_time AS (SELECT clock_timestamp() AS value)
      UPDATE platform.outbox_events
      SET
        status = ${deadLetter ? "DEAD_LETTER" : "FAILED"},
        attempt_count = ${attemptCount},
        available_at = CASE
          WHEN ${deadLetter} THEN failure_time.value
          ELSE failure_time.value + (${delaySeconds} * interval '1 second')
        END,
        lease_expires_at = NULL,
        claimed_by = NULL,
        claim_token = NULL,
        last_error = ${deadLetter ? this.sql.json(structuredError) : null},
        updated_at = failure_time.value
      FROM failure_time
      WHERE id = ${event.id}
        AND status = 'PROCESSING'
        AND claimed_by = ${this.workerId}
        AND claim_token = ${event.claimToken}
        AND lease_expires_at > clock_timestamp()
      RETURNING id
    `;
    if (rows.length === 0) throw new LostOutboxClaimError(event.eventId);

    if (deadLetter) {
      this.logger.error("Outbox event moved to dead letter", {
        eventId: event.eventId,
        correlationId: event.correlationId,
        attemptCount,
        error: structuredError,
        workerId: this.workerId,
      });
    } else {
      this.logger.info("Outbox event scheduled for retry", {
        eventId: event.eventId,
        correlationId: event.correlationId,
        attemptCount,
        retryAfterSeconds: delaySeconds,
        workerId: this.workerId,
      });
    }
  }

  async processOnce(): Promise<number> {
    const events = await this.claimBatch();
    for (const event of events) {
      try {
        await this.handler(event);
        await this.markProcessed(event);
      } catch (error) {
        if (error instanceof LostOutboxClaimError) {
          this.logLostClaim(event, error);
          continue;
        }
        try {
          await this.markFailed(event, error);
        } catch (failure) {
          if (failure instanceof LostOutboxClaimError) {
            this.logLostClaim(event, failure);
            continue;
          }
          throw failure;
        }
      }
    }
    return events.length;
  }

  private logLostClaim(event: ClaimedOutboxEvent, error: LostOutboxClaimError) {
    const context = {
      eventId: event.eventId,
      correlationId: event.correlationId,
      workerId: this.workerId,
      error: error.message,
    };
    if (this.logger.warn) this.logger.warn("Outbox claim lost", context);
    else this.logger.error("Outbox claim lost", context);
  }
}

const serializeError = (
  error: unknown,
  correlationId: string,
): { name: string; message: string; correlationId: string } => {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, correlationId };
  }
  return { name: "Error", message: String(error), correlationId };
};

export class LostOutboxClaimError extends Error {
  readonly name = "LostOutboxClaimError";

  constructor(readonly eventId: string) {
    super(`Outbox claim for ${eventId} is no longer owned by this worker`);
  }
}
