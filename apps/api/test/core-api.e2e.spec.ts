import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  Module,
} from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recalculateScheduleRequestedV1Schema } from "@teambuddy/contracts";

import { AppModule } from "../src/app.module.js";
import { DrizzleTeamRepository } from "../src/modules/team/team.repository.js";
import { createDatabaseClient } from "../src/platform/database/client.js";
import { migrateDatabase } from "../src/platform/database/migrate.js";
import { ApiErrorFilter } from "../src/platform/http/error.filter.js";

const baseDatabaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = baseDatabaseUrl ? describe : describe.skip;
const correlationId = "5d1aa77e-9e67-4bd0-a753-6061681bd5eb";

describeWithDatabase("core API", () => {
  let app: NestFastifyApplication;
  let baseUrl: string;
  let sql: ReturnType<typeof postgres>;
  const adminSql = postgres(baseDatabaseUrl ?? "", { max: 1 });
  const databaseName = `teambuddy_task6_${randomUUID().replaceAll("-", "")}`;
  const isolatedDatabaseUrl = new URL(
    baseDatabaseUrl ?? "postgres://localhost",
  );
  isolatedDatabaseUrl.pathname = `/${databaseName}`;

  beforeAll(async () => {
    await adminSql.unsafe(`CREATE DATABASE "${databaseName}"`);
    process.env.DATABASE_URL = isolatedDatabaseUrl.toString();
    await migrateDatabase(isolatedDatabaseUrl.toString());
    sql = postgres(isolatedDatabaseUrl.toString(), { max: 1 });
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
    await adminSql.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await adminSql.end({ timeout: 5 });
    process.env.DATABASE_URL = baseDatabaseUrl;
  });

  it("persists the complete team, portfolio and work workflow", async () => {
    const team = await request("/v1/teams", {
      method: "POST",
      body: {
        name: "研发一组",
        timezone: "Asia/Shanghai",
        defaultDailyHours: 6,
      },
      status: 201,
    });
    expect(team).toMatchObject({
      name: "研发一组",
      timezone: "Asia/Shanghai",
      defaultDailyHours: 6,
    });

    const invalidPriority = await request(`/v1/teams/${team.id}/projects`, {
      method: "POST",
      body: {
        name: "无效项目",
        priority: "P4",
        targetDate: "2026-09-18",
      },
      status: 400,
    });
    expect(invalidPriority).toMatchObject({
      code: "VALIDATION_ERROR",
      correlationId,
    });

    const member = await request(`/v1/teams/${team.id}/members`, {
      method: "POST",
      body: { name: "张三" },
      status: 201,
    });
    expect(member).toMatchObject({
      teamId: team.id,
      name: "张三",
      status: "ACTIVE",
      defaultDailyHours: 6,
    });

    const updatedMember = await request(
      `/v1/teams/${team.id}/members/${member.id}`,
      {
        method: "PATCH",
        body: { defaultDailyHours: 7 },
        status: 200,
      },
    );
    expect(updatedMember.defaultDailyHours).toBe(7);

    const otherTeam = await request("/v1/teams", {
      method: "POST",
      body: {
        name: "研发二组",
        timezone: "Asia/Shanghai",
        defaultDailyHours: 6,
      },
      status: 201,
    });
    const crossTeamMember = await request(
      `/v1/teams/${otherTeam.id}/members/${member.id}`,
      {
        method: "PATCH",
        body: { name: "越界更新" },
        status: 422,
      },
    );
    expect(crossTeamMember).toMatchObject({
      code: "MEMBER_NOT_IN_TEAM",
      correlationId,
    });
    const missingParentMember = await request(
      `/v1/teams/${randomUUID()}/members/${member.id}`,
      {
        method: "PATCH",
        body: { name: "父团队不存在" },
        status: 404,
      },
    );
    expect(missingParentMember).toMatchObject({
      code: "TEAM_NOT_FOUND",
      correlationId,
    });

    const members = await request(`/v1/teams/${team.id}/members`, {
      status: 200,
    });
    expect(members).toEqual([updatedMember]);

    const project = await request(`/v1/teams/${team.id}/projects`, {
      method: "POST",
      body: {
        name: "支付重构",
        priority: "P0",
        targetDate: "2026-09-18",
        ownerMemberId: member.id,
      },
      status: 201,
    });
    expect(project).toMatchObject({
      teamId: team.id,
      name: "支付重构",
      priority: "P0",
      targetDate: "2026-09-18",
      ownerMemberId: member.id,
    });

    const updatedProject = await request(
      `/v1/teams/${team.id}/projects/${project.id}`,
      {
        method: "PATCH",
        body: { status: "IN_PROGRESS" },
        status: 200,
      },
    );
    expect(updatedProject.status).toBe("IN_PROGRESS");

    const crossTeamProject = await request(
      `/v1/teams/${otherTeam.id}/projects/${project.id}`,
      {
        method: "PATCH",
        body: { name: "越界更新" },
        status: 422,
      },
    );
    expect(crossTeamProject).toMatchObject({
      code: "PROJECT_NOT_IN_TEAM",
      correlationId,
    });
    const missingParentProject = await request(
      `/v1/teams/${randomUUID()}/projects/${project.id}`,
      {
        method: "PATCH",
        body: { name: "父团队不存在" },
        status: 404,
      },
    );
    expect(missingParentProject).toMatchObject({
      code: "TEAM_NOT_FOUND",
      correlationId,
    });

    const projects = await request(`/v1/teams/${team.id}/projects`, {
      status: 200,
    });
    expect(projects).toEqual([updatedProject]);

    const milestone = await request(`/v1/projects/${project.id}/milestones`, {
      method: "POST",
      body: {
        name: "联调完成",
        targetDate: "2026-09-11",
      },
      status: 201,
    });
    expect(milestone).toMatchObject({
      projectId: project.id,
      name: "联调完成",
      targetDate: "2026-09-11",
      manualRank: 0,
    });

    const updatedMilestone = await request(
      `/v1/projects/${project.id}/milestones/${milestone.id}`,
      {
        method: "PATCH",
        body: { manualRank: 1 },
        status: 200,
      },
    );
    expect(updatedMilestone.manualRank).toBe(1);
    const missingParentMilestone = await request(
      `/v1/projects/${randomUUID()}/milestones/${milestone.id}`,
      {
        method: "PATCH",
        body: { name: "父项目不存在" },
        status: 404,
      },
    );
    expect(missingParentMilestone).toMatchObject({
      code: "PROJECT_NOT_FOUND",
      correlationId,
    });
    const missingParentAndMilestone = await request(
      `/v1/projects/${randomUUID()}/milestones/${randomUUID()}`,
      {
        method: "PATCH",
        body: { name: "父子资源均不存在" },
        status: 404,
      },
    );
    expect(missingParentAndMilestone).toMatchObject({
      code: "PROJECT_NOT_FOUND",
      correlationId,
    });
    const milestoneList = await request(
      `/v1/projects/${project.id}/milestones`,
      { status: 200 },
    );
    expect(milestoneList).toEqual([updatedMilestone]);

    const unknownAssignee = await request(`/v1/projects/${project.id}/tasks`, {
      method: "POST",
      body: {
        assigneeId: randomUUID(),
        name: "未知负责人任务",
        estimatedHours: 1,
        remainingHours: 1,
      },
      status: 422,
    });
    expect(unknownAssignee).toMatchObject({
      code: "MEMBER_NOT_IN_TEAM",
      correlationId,
    });

    const task = await request(`/v1/projects/${project.id}/tasks`, {
      method: "POST",
      body: {
        milestoneId: milestone.id,
        assigneeId: member.id,
        name: "支付接口联调",
        estimatedHours: 12,
        remainingHours: 12,
      },
      status: 201,
    });
    expect(task).toMatchObject({
      projectId: project.id,
      milestoneId: milestone.id,
      assigneeId: member.id,
      name: "支付接口联调",
      estimatedHours: 12,
      remainingHours: 12,
    });

    const predecessor = await request(`/v1/projects/${project.id}/tasks`, {
      method: "POST",
      body: {
        assigneeId: member.id,
        name: "接口定义",
        estimatedHours: 2,
        remainingHours: 2,
      },
      status: 201,
    });

    const updatedTask = await request(
      `/v1/projects/${project.id}/tasks/${task.id}`,
      {
        method: "PATCH",
        body: { remainingHours: 6, status: "IN_PROGRESS" },
        status: 200,
      },
    );
    expect(updatedTask).toMatchObject({
      remainingHours: 6,
      status: "IN_PROGRESS",
    });
    const missingParentTask = await request(
      `/v1/projects/${randomUUID()}/tasks/${task.id}`,
      {
        method: "PATCH",
        body: { name: "父项目不存在" },
        status: 404,
      },
    );
    expect(missingParentTask).toMatchObject({
      code: "PROJECT_NOT_FOUND",
      correlationId,
    });
    const taskList = await request(`/v1/projects/${project.id}/tasks`, {
      status: 200,
    });
    expect(taskList).toEqual(
      [task, predecessor].map((item) =>
        item.id === task.id ? updatedTask : item,
      ),
    );

    await request(`/v1/tasks/${task.id}/dependencies`, {
      method: "POST",
      body: { predecessorTaskId: predecessor.id },
      status: 201,
    });
    const dependencyCycle = await request(
      `/v1/tasks/${predecessor.id}/dependencies`,
      {
        method: "POST",
        body: { predecessorTaskId: task.id },
        status: 422,
      },
    );
    expect(dependencyCycle).toMatchObject({
      code: "DEPENDENCY_CYCLE",
      correlationId,
    });

    const capacity = await request(
      `/v1/members/${member.id}/capacity-exceptions/2026-09-04`,
      {
        method: "PUT",
        body: { availableHours: 0, reason: "请假" },
        status: 200,
      },
    );
    expect(capacity).toMatchObject({
      memberId: member.id,
      date: "2026-09-04",
      availableHours: 0,
      reason: "请假",
    });

    const detail = await request(`/v1/projects/${project.id}`, {
      status: 200,
    });
    expect(detail).toEqual({
      project: updatedProject,
      milestones: [updatedMilestone],
      tasks: [task, predecessor].map((item) =>
        item.id === task.id ? updatedTask : item,
      ),
    });

    expectNoDatabaseKeys(detail);
    const outboxRows = await sql<
      {
        event_id: string;
        idempotency_key: string;
        type: string;
        correlation_id: string;
        aggregate_id: string;
        occurred_at: Date;
        payload: unknown;
      }[]
    >`
      SELECT
        event_id,
        idempotency_key,
        type,
        correlation_id,
        aggregate_id,
        occurred_at,
        payload
      FROM platform.outbox_events
      ORDER BY created_at
    `;
    expect(outboxRows).toHaveLength(10);
    for (const row of outboxRows) {
      const event = recalculateScheduleRequestedV1Schema.parse(row.payload);
      expect(row).toMatchObject({
        type: "planning.recalculate.requested.v1",
        correlation_id: correlationId,
        payload: expect.objectContaining({
          type: "planning.recalculate.requested.v1",
          teamId: team.id,
          correlationId,
        }),
      });
      expect(row.event_id).toBe(event.eventId);
      expect(row.idempotency_key).toBe(row.event_id);
      expect(row.aggregate_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.occurred_at.toISOString()).toBe(event.requestedAt);
    }
    const aggregateCounts = new Map<string, number>();
    for (const { aggregate_id: aggregateId } of outboxRows) {
      aggregateCounts.set(
        aggregateId,
        (aggregateCounts.get(aggregateId) ?? 0) + 1,
      );
    }
    expect(aggregateCounts).toEqual(
      new Map([
        [member.id, 3],
        [project.id, 2],
        [milestone.id, 1],
        [task.id, 3],
        [predecessor.id, 1],
      ]),
    );

    const archivedMember = await request(
      `/v1/teams/${team.id}/members/${member.id}`,
      {
        method: "PATCH",
        body: { status: "INACTIVE" },
        status: 200,
      },
    );
    const archivedProject = await request(
      `/v1/teams/${team.id}/projects/${project.id}`,
      {
        method: "PATCH",
        body: { status: "CANCELED" },
        status: 200,
      },
    );
    expect(archivedMember.status).toBe("INACTIVE");
    expect(archivedProject.status).toBe("CANCELED");

    await request(`/v1/teams/${team.id}/members/${member.id}`, {
      method: "PATCH",
      body: { status: "ACTIVE" },
      status: 200,
    });
    await request(`/v1/teams/${team.id}/projects/${project.id}`, {
      method: "PATCH",
      body: { status: "PLANNING" },
      status: 200,
    });
    const [outboxAfterArchiveAndRestore] = await sql<{ value: number }[]>`
      SELECT count(*)::int AS value FROM platform.outbox_events
    `;
    expect(outboxAfterArchiveAndRestore?.value).toBe(14);
  });

  it("returns stable missing-resource and strict-body errors", async () => {
    const missing = await request(`/v1/projects/${randomUUID()}`, {
      status: 404,
    });
    expect(missing).toMatchObject({
      code: "PROJECT_NOT_FOUND",
      correlationId,
    });

    const invalidId = await request("/v1/projects/not-a-uuid", {
      status: 400,
    });
    expect(invalidId).toMatchObject({
      code: "VALIDATION_ERROR",
      correlationId,
    });

    const dateTeam = await request("/v1/teams", {
      method: "POST",
      body: {
        name: "日期校验团队",
        timezone: "Asia/Shanghai",
        defaultDailyHours: 6,
      },
      status: 201,
    });
    const invalidBodyDate = await request(`/v1/teams/${dateTeam.id}/projects`, {
      method: "POST",
      body: {
        name: "非法日期项目",
        priority: "P1",
        targetDate: "2026-02-29",
      },
      status: 400,
    });
    expect(invalidBodyDate).toMatchObject({
      code: "VALIDATION_ERROR",
      correlationId,
    });

    const conflictBody = {
      name: "重复团队",
      timezone: "Asia/Shanghai",
      defaultDailyHours: 6,
    };
    await request("/v1/teams", {
      method: "POST",
      body: conflictBody,
      status: 201,
    });
    const conflict = await request("/v1/teams", {
      method: "POST",
      body: conflictBody,
      status: 422,
    });
    expect(conflict).toMatchObject({
      code: "DOMAIN_CONFLICT",
      correlationId,
    });

    const invalid = await request("/v1/teams", {
      method: "POST",
      body: {
        name: "严格校验",
        timezone: "Asia/Shanghai",
        defaultDailyHours: 6,
        created_at: "should-not-be-accepted",
      },
      status: 400,
    });
    expect(invalid).toMatchObject({
      code: "VALIDATION_ERROR",
      correlationId,
    });
    expect(JSON.stringify(invalid)).not.toContain("stack");
  });

  it("sanitizes real HTTP 500 responses and preserves legal 4xx errors", async () => {
    const failureApp = await NestFactory.create<NestFastifyApplication>(
      ErrorFilterTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await failureApp.listen(0, "127.0.0.1");
    const failureUrl = await failureApp.getUrl();
    try {
      for (const path of ["ordinary", "nest-500"]) {
        const response = await fetch(`${failureUrl}/${path}`, {
          headers: { "x-correlation-id": correlationId },
        });
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
          correlationId,
        });
      }
      const legal = await fetch(`${failureUrl}/legal-4xx`, {
        headers: { "x-correlation-id": correlationId },
      });
      expect(legal.status).toBe(400);
      expect(await legal.json()).toEqual({
        code: "LEGAL_4XX",
        message: "Safe client message",
        details: { field: "priority" },
        correlationId,
      });
    } finally {
      await failureApp.close();
    }
  });

  it("inherits team capacity and rejects invalid date paths", async () => {
    const team = await request("/v1/teams", {
      method: "POST",
      body: {
        name: "八小时团队",
        timezone: "Asia/Shanghai",
        defaultDailyHours: 8,
      },
      status: 201,
    });
    const member = await request(`/v1/teams/${team.id}/members`, {
      method: "POST",
      body: { name: "继承成员" },
      status: 201,
    });
    expect(member.defaultDailyHours).toBe(8);

    const connection = createDatabaseClient(isolatedDatabaseUrl.toString());
    try {
      const snapshot = await new DrizzleTeamRepository(
        connection.db,
      ).readCapacitySnapshot(team.id);
      expect(snapshot.team.defaultDailyHours).toBe(8);
      expect(snapshot.members).toEqual([member]);
    } finally {
      await connection.close();
    }

    const invalidPathDate = await request(
      `/v1/members/${member.id}/capacity-exceptions/2026-02-29`,
      {
        method: "PUT",
        body: { availableHours: 0 },
        status: 400,
      },
    );
    expect(invalidPathDate).toMatchObject({
      code: "VALIDATION_ERROR",
      correlationId,
    });

    const [before] = await sql<{ value: number }[]>`
      SELECT count(*)::int AS value FROM platform.outbox_events
    `;
    const capacityMutation = () =>
      request(`/v1/members/${member.id}/capacity-exceptions/2026-09-04`, {
        method: "PUT",
        body: { availableHours: 0, reason: "请假" },
        status: 200,
      });
    await capacityMutation();
    await capacityMutation();
    const [after] = await sql<{ value: number }[]>`
      SELECT count(*)::int AS value FROM platform.outbox_events
    `;
    expect(after!.value - before!.value).toBe(1);
  });

  it("classifies cross-project nested resources as domain conflicts", async () => {
    const { team, member, project, firstTask } =
      await createDependencyFixture("Nested Scope");
    const otherProject = await request(`/v1/teams/${team.id}/projects`, {
      method: "POST",
      body: {
        name: "Nested Other Project",
        priority: "P2",
        targetDate: "2026-10-01",
      },
      status: 201,
    });
    const milestone = await request(`/v1/projects/${project.id}/milestones`, {
      method: "POST",
      body: { name: "Nested Milestone", targetDate: "2026-09-20" },
      status: 201,
    });

    const crossMilestone = await request(
      `/v1/projects/${otherProject.id}/milestones/${milestone.id}`,
      {
        method: "PATCH",
        body: { name: "Cross Milestone" },
        status: 422,
      },
    );
    expect(crossMilestone).toMatchObject({
      code: "MILESTONE_NOT_IN_PROJECT",
      correlationId,
    });
    const crossTask = await request(
      `/v1/projects/${otherProject.id}/tasks/${firstTask.id}`,
      {
        method: "PATCH",
        body: { assigneeId: member.id },
        status: 422,
      },
    );
    expect(crossTask).toMatchObject({
      code: "TASK_NOT_IN_PROJECT",
      correlationId,
    });
  });

  it("emits PATCH events only for real scheduling input changes", async () => {
    const { team, member, project, firstTask } =
      await createDependencyFixture("Selective");
    const milestone = await request(`/v1/projects/${project.id}/milestones`, {
      method: "POST",
      body: { name: "Selective Milestone", targetDate: "2026-09-20" },
      status: 201,
    });
    const patchRoutes = [
      `/v1/teams/${team.id}/members/${member.id}`,
      `/v1/teams/${team.id}/projects/${project.id}`,
      `/v1/projects/${project.id}/milestones/${milestone.id}`,
      `/v1/projects/${project.id}/tasks/${firstTask.id}`,
    ];
    for (const path of patchRoutes) {
      const empty = await request(path, {
        method: "PATCH",
        body: {},
        status: 400,
      });
      expect(empty).toMatchObject({ code: "VALIDATION_ERROR", correlationId });
    }

    const countEvents = async () => {
      const [row] = await sql<{ value: number }[]>`
        SELECT count(*)::int AS value FROM platform.outbox_events
      `;
      return row!.value;
    };
    const beforeNames = await countEvents();
    await request(patchRoutes[0]!, {
      method: "PATCH",
      body: { name: "Renamed Member" },
      status: 200,
    });
    await request(patchRoutes[1]!, {
      method: "PATCH",
      body: { name: "Renamed Project" },
      status: 200,
    });
    await request(patchRoutes[2]!, {
      method: "PATCH",
      body: { name: "Renamed Milestone" },
      status: 200,
    });
    await request(patchRoutes[3]!, {
      method: "PATCH",
      body: { name: "Renamed Task" },
      status: 200,
    });
    expect(await countEvents()).toBe(beforeNames);

    await request(patchRoutes[0]!, {
      method: "PATCH",
      body: { defaultDailyHours: 7 },
      status: 200,
    });
    await request(patchRoutes[1]!, {
      method: "PATCH",
      body: { priority: "P0" },
      status: 200,
    });
    await request(patchRoutes[2]!, {
      method: "PATCH",
      body: { targetDate: "2026-09-19" },
      status: 200,
    });
    await request(patchRoutes[3]!, {
      method: "PATCH",
      body: { remainingHours: 0 },
      status: 200,
    });
    const afterSchedulingChanges = await countEvents();
    expect(afterSchedulingChanges - beforeNames).toBe(4);

    await request(patchRoutes[0]!, {
      method: "PATCH",
      body: { defaultDailyHours: 7 },
      status: 200,
    });
    await request(patchRoutes[1]!, {
      method: "PATCH",
      body: { priority: "P0" },
      status: 200,
    });
    await request(patchRoutes[2]!, {
      method: "PATCH",
      body: { targetDate: "2026-09-19" },
      status: 200,
    });
    await request(patchRoutes[3]!, {
      method: "PATCH",
      body: { remainingHours: 0 },
      status: 200,
    });
    expect(await countEvents()).toBe(afterSchedulingChanges);
  });

  it("serializes concurrent opposite dependencies so the graph stays acyclic", async () => {
    const { firstTask, secondTask } = await createDependencyFixture("Opposite");
    const [before] = await sql<{ value: number }[]>`
      SELECT count(*)::int AS value FROM platform.outbox_events
    `;

    const responses = await Promise.all([
      send(`/v1/tasks/${secondTask.id}/dependencies`, {
        method: "POST",
        body: { predecessorTaskId: firstTask.id },
      }),
      send(`/v1/tasks/${firstTask.id}/dependencies`, {
        method: "POST",
        body: { predecessorTaskId: secondTask.id },
      }),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 422]);
    expect(
      responses.find(({ status }) => status === 422)?.payload,
    ).toMatchObject({ code: "DEPENDENCY_CYCLE", correlationId });
    const dependencies = await sql<
      { predecessor_task_id: string; successor_task_id: string }[]
    >`
      SELECT predecessor_task_id, successor_task_id
      FROM work.task_dependencies
    `;
    expect(dependencies).toHaveLength(1);
    const [after] = await sql<{ value: number }[]>`
      SELECT count(*)::int AS value FROM platform.outbox_events
    `;
    expect(after!.value - before!.value).toBe(1);
  });

  it("treats concurrent duplicate dependencies as one mutation and one event", async () => {
    const { firstTask, secondTask } =
      await createDependencyFixture("Duplicate");
    const [before] = await sql<{ value: number }[]>`
      SELECT count(*)::int AS value FROM platform.outbox_events
    `;
    const mutation = () =>
      send(`/v1/tasks/${secondTask.id}/dependencies`, {
        method: "POST",
        body: { predecessorTaskId: firstTask.id },
      });

    const responses = await Promise.all([mutation(), mutation()]);

    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    const [dependencyCount] = await sql<{ value: number }[]>`
      SELECT count(*)::int AS value FROM work.task_dependencies
    `;
    expect(dependencyCount?.value).toBe(1);
    const [after] = await sql<{ value: number }[]>`
      SELECT count(*)::int AS value FROM platform.outbox_events
    `;
    expect(after!.value - before!.value).toBe(1);
  });

  async function createDependencyFixture(prefix: string) {
    const team = await request("/v1/teams", {
      method: "POST",
      body: {
        name: `${prefix} Team`,
        timezone: "Asia/Shanghai",
        defaultDailyHours: 6,
      },
      status: 201,
    });
    const member = await request(`/v1/teams/${team.id}/members`, {
      method: "POST",
      body: { name: `${prefix} Member` },
      status: 201,
    });
    const project = await request(`/v1/teams/${team.id}/projects`, {
      method: "POST",
      body: {
        name: `${prefix} Project`,
        priority: "P1",
        targetDate: "2026-09-30",
      },
      status: 201,
    });
    const createTask = (name: string) =>
      request(`/v1/projects/${project.id}/tasks`, {
        method: "POST",
        body: {
          assigneeId: member.id,
          name,
          estimatedHours: 1,
          remainingHours: 1,
        },
        status: 201,
      });
    const [firstTask, secondTask] = await Promise.all([
      createTask(`${prefix} A`),
      createTask(`${prefix} B`),
    ]);
    return { team, member, project, firstTask, secondTask };
  }

  async function request(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      status: number;
    },
  ): Promise<any> {
    const response = await send(path, options);
    expect(response.status, JSON.stringify(response.payload)).toBe(
      options.status,
    );
    return response.payload;
  }

  async function send(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
    },
  ): Promise<{ status: number; payload: any }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json();
    return { status: response.status, payload };
  }
});

const expectNoDatabaseKeys = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(expectNoDatabaseKeys);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      expect(key).not.toMatch(/_/);
      expectNoDatabaseKeys(child);
    }
  }
};

class ErrorFilterTestController {
  ordinary(): never {
    throw new Error("sensitive ordinary error");
  }

  nest500(): never {
    throw new InternalServerErrorException({
      code: "LEAKED_500",
      message: "sensitive Nest 500",
      details: { stack: "private" },
    });
  }

  legal4xx(): never {
    throw new BadRequestException({
      code: "LEGAL_4XX",
      message: "Safe client message",
      details: { field: "priority" },
    });
  }
}

Controller()(ErrorFilterTestController);
for (const [path, method] of [
  ["ordinary", "ordinary"],
  ["nest-500", "nest500"],
  ["legal-4xx", "legal4xx"],
] as const) {
  Get(path)(
    ErrorFilterTestController.prototype,
    method,
    Object.getOwnPropertyDescriptor(
      ErrorFilterTestController.prototype,
      method,
    )!,
  );
}

class ErrorFilterTestModule {}
Module({
  controllers: [ErrorFilterTestController],
  providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
})(ErrorFilterTestModule);
