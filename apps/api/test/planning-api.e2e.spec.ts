import { randomUUID } from "node:crypto";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { migrateDatabase } from "../src/platform/database/migrate.js";

const baseDatabaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = baseDatabaseUrl ? describe : describe.skip;
const correlationId = "5d1aa77e-9e67-4bd0-a753-6061681bd5eb";

describeWithDatabase("planning API", () => {
  const admin = postgres(baseDatabaseUrl ?? "", { max: 1 });
  const databaseName = `teambuddy_task7_api_${randomUUID().replaceAll("-", "")}`;
  const isolatedUrl = new URL(baseDatabaseUrl ?? "postgres://localhost");
  isolatedUrl.pathname = `/${databaseName}`;
  let app: NestFastifyApplication;
  let baseUrl: string;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    process.env.DATABASE_URL = isolatedUrl.toString();
    await migrateDatabase(isolatedUrl.toString());
    sql = postgres(isolatedUrl.toString(), { max: 1 });
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    await sql.unsafe(`
      TRUNCATE TABLE
        platform.outbox_events,
        planning.task_allocation_overrides,
        planning.schedule_allocations,
        planning.schedule_versions,
        work.task_dependencies,
        work.tasks,
        portfolio.milestones,
        portfolio.projects,
        team.capacity_exceptions,
        team.members,
        team.teams
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    await app?.close();
    await sql?.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end({ timeout: 5 });
    process.env.DATABASE_URL = baseDatabaseUrl;
  });

  it("queues a versioned recalculation event within the request transaction", async () => {
    const teamId = await seedTeam();

    const response = await request(`/v1/teams/${teamId}/planning/recalculate`, {
      method: "POST",
      status: 201,
    });

    expect(response).toMatchObject({ status: "queued" });
    const [event] = await sql<
      { eventId: string; type: string; correlationId: string; teamId: string }[]
    >`
      SELECT
        event_id AS "eventId",
        type,
        correlation_id AS "correlationId",
        payload->>'teamId' AS "teamId"
      FROM platform.outbox_events
      WHERE event_id = ${response.eventId}
    `;
    expect(event).toEqual({
      eventId: response.eventId,
      type: "planning.recalculate.requested.v1",
      correlationId,
      teamId,
    });
  });

  it("returns the latest draft with allocations in stable date/member/task order", async () => {
    const teamId = await seedTeam();
    const olderId = randomUUID();
    const latestId = randomUUID();
    const sourceEventId = randomUUID();
    await sql`
      INSERT INTO planning.schedule_versions (
        id, team_id, source_event_id, result_fingerprint, created_at, updated_at
      ) VALUES
        (${olderId}, ${teamId}, ${randomUUID()}, ${"a".repeat(64)}, now() - interval '1 second', now() - interval '1 second'),
        (${latestId}, ${teamId}, ${sourceEventId}, ${"b".repeat(64)}, now(), now())
    `;
    const taskA = randomUUID();
    const taskB = randomUUID();
    const memberA = randomUUID();
    const memberB = randomUUID();
    await sql`
      INSERT INTO planning.schedule_allocations (
        schedule_version_id, task_id, member_id, date, hours, source
      ) VALUES
        (${latestId}, ${taskB}, ${memberA}, '2026-09-03', 2, 'AUTOMATIC'),
        (${latestId}, ${taskB}, ${memberB}, '2026-09-02', 2, 'AUTOMATIC'),
        (${latestId}, ${taskA}, ${memberA}, '2026-09-02', 2, 'MANUAL')
    `;

    const result = await request(`/v1/teams/${teamId}/schedules/latest`, {
      status: 200,
    });

    expect(result).toMatchObject({
      id: latestId,
      teamId,
      sourceEventId,
      status: "DRAFT",
    });
    const expectedOrder = [
      { date: "2026-09-03", memberId: memberA, taskId: taskB },
      { date: "2026-09-02", memberId: memberB, taskId: taskB },
      { date: "2026-09-02", memberId: memberA, taskId: taskA },
    ].sort((left, right) =>
      `${left.date}:${left.memberId}:${left.taskId}`.localeCompare(
        `${right.date}:${right.memberId}:${right.taskId}`,
      ),
    );
    expect(result.allocations).toEqual(
      expectedOrder.map((allocation) => expect.objectContaining(allocation)),
    );
  });

  it("accepts a historical task window and queues recalculation", async () => {
    const teamId = await seedTeam();
    const memberId = randomUUID();
    const projectId = randomUUID();
    const taskId = randomUUID();
    const startDate = "2020-09-07";
    const endDate = addDays(startDate, 4);
    await sql`
      INSERT INTO team.members (id, team_id, name, status, default_daily_hours)
      VALUES (${memberId}, ${teamId}, '张三', 'ACTIVE', 6)
    `;
    await sql`
      INSERT INTO portfolio.projects (
        id, team_id, name, priority, target_date, status, health
      ) VALUES (
        ${projectId}, ${teamId}, '支付重构', 'P0', ${endDate}, 'IN_PROGRESS', 'HEALTHY'
      )
    `;
    await sql`
      INSERT INTO work.tasks (
        id, project_id, assignee_id, name, estimated_hours, remaining_hours, status
      ) VALUES (
        ${taskId}, ${projectId}, ${memberId}, '支付接口联调', 12, 12, 'IN_PROGRESS'
      )
    `;

    const result = await request(
      `/v1/teams/${teamId}/planning/tasks/${taskId}/window`,
      {
        method: "PUT",
        status: 200,
        body: { startDate, endDate, adjustTaskHours: true },
      },
    );

    expect(result).toMatchObject({ status: "queued" });
    const overrides = await sql<
      { date: string; hours: number; locked: boolean }[]
    >`
      SELECT date::text, hours::float8, locked
      FROM planning.task_allocation_overrides
      WHERE team_id = ${teamId} AND task_id = ${taskId}
      ORDER BY date
    `;
    expect(overrides).toHaveLength(5);
    expect(overrides.reduce((total, row) => total + row.hours, 0)).toBe(30);
    expect(overrides.every(({ locked }) => locked)).toBe(true);
    const [task] = await sql<
      { estimatedHours: number; remainingHours: number }[]
    >`
      SELECT
        estimated_hours::float8 AS "estimatedHours",
        remaining_hours::float8 AS "remainingHours"
      FROM work.tasks
      WHERE id = ${taskId}
    `;
    expect(task).toEqual({ estimatedHours: 30, remainingHours: 30 });
    const [event] = await sql<{ horizonEndDate: string }[]>`
      SELECT payload->>'horizonEndDate' AS "horizonEndDate"
      FROM platform.outbox_events
      WHERE event_id = ${result.eventId}
    `;
    expect(event?.horizonEndDate).toBe(endDate);
  });

  it("keeps nonexistent team failures within the team endpoint scope", async () => {
    const missingTeamId = randomUUID();

    for (const [path, method] of [
      [`/v1/teams/${missingTeamId}/planning/recalculate`, "POST"],
      [`/v1/teams/${missingTeamId}/schedules/latest`, "GET"],
    ] as const) {
      expect(await request(path, { method, status: 404 })).toMatchObject({
        code: "TEAM_NOT_FOUND",
        correlationId,
      });
    }
  });

  async function seedTeam(): Promise<string> {
    const id = randomUUID();
    await sql`
      INSERT INTO team.teams (id, name, timezone, default_daily_hours)
      VALUES (${id}, '计划组', 'Asia/Shanghai', 6)
    `;
    return id;
  }

  async function request(
    path: string,
    options: { method?: string; status: number; body?: unknown },
  ): Promise<any> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "x-correlation-id": correlationId,
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(options.status);
    return payload;
  }
});

const addDays = (date: string, count: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
};
