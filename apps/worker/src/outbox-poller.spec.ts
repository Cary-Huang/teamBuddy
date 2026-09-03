import { randomUUID } from "node:crypto";

import { migrateBackendDatabase } from "@teambuddy/api/backend";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  OutboxPoller,
  type OutboxHandler,
  type WorkerLogger,
} from "./outbox-poller.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgreSQL Outbox poller", () => {
  const adminUrl = new URL(databaseUrl ?? "postgres://localhost");
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1 });
  const databaseName = `teambuddy_task7_poller_${randomUUID().replaceAll("-", "")}`;
  const isolatedUrl = new URL(databaseUrl ?? "postgres://localhost");
  isolatedUrl.pathname = `/${databaseName}`;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    sql = postgres(isolatedUrl.toString(), { max: 10 });
    await migrateBackendDatabase(isolatedUrl.toString());
  });

  beforeEach(async () => {
    await sql`TRUNCATE platform.outbox_events`;
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  });

  it("uses row locks so two pollers never claim the same event", async () => {
    await seedEvent();
    const first = poller("worker-a");
    const second = poller("worker-b");

    const [firstClaims, secondClaims] = await Promise.all([
      first.claimBatch(),
      second.claimBatch(),
    ]);

    expect([...firstClaims, ...secondClaims]).toHaveLength(1);
    expect(
      new Set([...firstClaims, ...secondClaims].map(({ id }) => id)).size,
    ).toBe(1);
  });

  it("claims no more than 20 and never reclaims processed events", async () => {
    await Promise.all(Array.from({ length: 22 }, () => seedEvent()));
    const subject = poller("worker-a");

    const claims = await subject.claimBatch();
    expect(claims).toHaveLength(20);

    await Promise.all(claims.map((event) => subject.markProcessed(event)));
    const nextClaims = await subject.claimBatch();
    expect(nextClaims).toHaveLength(2);
    const processedIds = new Set(claims.map(({ id }) => id));
    expect(nextClaims.every(({ id }) => !processedIds.has(id))).toBe(true);
  });

  it("reclaims a processing event after its 60-second lease expires", async () => {
    await seedEvent();
    const first = poller("worker-a");
    const [claimed] = await first.claimBatch();
    expect(claimed).toBeDefined();
    await sql`
      UPDATE platform.outbox_events
      SET lease_expires_at = now() - interval '1 second'
      WHERE id = ${claimed!.id}
    `;

    const [reclaimed] = await poller("worker-b").claimBatch();
    expect(reclaimed?.id).toBe(claimed!.id);
    expect(reclaimed?.claimedBy).toBe("worker-b");
  });

  it("rejects stale terminal writes after same-worker and cross-worker reclaims", async () => {
    await seedEvent();
    const original = poller("worker-a");
    const [firstClaim] = await original.claimBatch();
    await sql`
      UPDATE platform.outbox_events
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${firstClaim!.id}
    `;
    const [sameWorkerClaim] = await original.claimBatch();
    expect(sameWorkerClaim!.claimToken).not.toBe(firstClaim!.claimToken);
    await expect(original.markProcessed(firstClaim!)).rejects.toMatchObject({
      name: "LostOutboxClaimError",
    });

    await sql`
      UPDATE platform.outbox_events
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${sameWorkerClaim!.id}
    `;
    const foreignWorker = poller("worker-b");
    const [foreignClaim] = await foreignWorker.claimBatch();
    await expect(
      original.markFailed(sameWorkerClaim!, new Error("stale")),
    ).rejects.toMatchObject({
      name: "LostOutboxClaimError",
    });
    const [state] = await sql<
      { status: string; claimedBy: string; claimToken: string }[]
    >`
      SELECT status, claimed_by AS "claimedBy", claim_token AS "claimToken"
      FROM platform.outbox_events WHERE id = ${foreignClaim!.id}
    `;
    expect(state).toEqual({
      status: "PROCESSING",
      claimedBy: "worker-b",
      claimToken: foreignClaim!.claimToken,
    });
  });

  it("rejects terminal writes after expiry even before another worker reclaims", async () => {
    await seedEvent();
    const subject = poller("worker-a");
    const [claim] = await subject.claimBatch();
    await sql`
      UPDATE platform.outbox_events
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${claim!.id}
    `;
    await expect(subject.markProcessed(claim!)).rejects.toMatchObject({
      name: "LostOutboxClaimError",
    });
  });

  it("continues the batch after a lost claim and logs its structured context", async () => {
    const firstEventId = await seedEvent();
    const secondEventId = await seedEvent();
    const logger: WorkerLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
    const handled: string[] = [];
    const subject = poller("worker-a", logger, async (event) => {
      handled.push(event.eventId);
      if (event.eventId === firstEventId) {
        await sql`
          UPDATE platform.outbox_events
          SET lease_expires_at = clock_timestamp() - interval '1 second'
          WHERE id = ${event.id}
        `;
      }
    });

    await expect(subject.processOnce()).resolves.toBe(2);
    expect(handled).toEqual([firstEventId, secondEventId]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Outbox claim lost",
      expect.objectContaining({ eventId: firstEventId, workerId: "worker-a" }),
    );
  });

  it.each([
    [1, 5],
    [2, 30],
    [3, 120],
    [4, 600],
  ])(
    "failure attempt %i retries after %i seconds",
    async (attempt, delaySeconds) => {
      const subject = poller("worker-a");
      const eventId = await seedEvent({ attemptCount: attempt - 1 });
      const [event] = await subject.claimBatch();
      await subject.markFailed(event!, new Error("temporary"));

      const [row] = await sql<
        {
          attemptCount: number;
          status: string;
          delaySeconds: number;
          lastError: unknown;
        }[]
      >`
      SELECT
        attempt_count AS "attemptCount",
        status,
        extract(epoch from (available_at - updated_at))::int AS "delaySeconds",
        last_error AS "lastError"
      FROM platform.outbox_events
      WHERE event_id = ${eventId}
    `;
      expect(row).toEqual({
        attemptCount: attempt,
        status: "FAILED",
        delaySeconds,
        lastError: null,
      });
    },
  );

  it("dead-letters the fifth failure and logs one structured final error", async () => {
    const logger: WorkerLogger = { info: vi.fn(), error: vi.fn() };
    const eventId = await seedEvent({ attemptCount: 4 });
    const subject = poller("worker-a", logger);
    const [event] = await subject.claimBatch();

    await subject.markFailed(event!, new TypeError("invalid snapshot"));

    const [row] = await sql<
      {
        status: string;
        attemptCount: number;
        lastError: Record<string, unknown>;
      }[]
    >`
      SELECT status, attempt_count AS "attemptCount", last_error AS "lastError"
      FROM platform.outbox_events
      WHERE event_id = ${eventId}
    `;
    expect(row).toMatchObject({
      status: "DEAD_LETTER",
      attemptCount: 5,
      lastError: {
        name: "TypeError",
        message: "invalid snapshot",
        correlationId: event!.correlationId,
      },
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Outbox event moved to dead letter",
      expect.objectContaining({
        eventId,
        correlationId: event!.correlationId,
        attemptCount: 5,
      }),
    );
  });

  const poller = (
    workerId: string,
    logger: WorkerLogger = silentLogger,
    handler: OutboxHandler = async () => undefined,
  ) => new OutboxPoller(sql, handler, logger, workerId);

  const seedEvent = async (options: { attemptCount?: number } = {}) => {
    const eventId = randomUUID();
    const correlationId = randomUUID();
    await sql`
      INSERT INTO platform.outbox_events (
        event_id,
        idempotency_key,
        type,
        correlation_id,
        aggregate_id,
        payload,
        attempt_count
      ) VALUES (
        ${eventId},
        ${eventId},
        'planning.recalculate.requested.v1',
        ${correlationId},
        ${randomUUID()},
        ${sql.json({
          type: "planning.recalculate.requested.v1",
          eventId,
          correlationId,
          teamId: randomUUID(),
          requestedAt: "2026-09-02T00:00:00.000Z",
        })},
        ${options.attemptCount ?? 0}
      )
    `;
    return eventId;
  };
});

const silentLogger: WorkerLogger = {
  info: () => undefined,
  error: () => undefined,
};
