import { randomUUID } from "node:crypto";

import {
  createBackendApplicationPorts,
  migrateBackendDatabase,
  type BackendApplicationPorts,
} from "@teambuddy/api/backend";
import type {
  CapacitySnapshotDto,
  ScheduleComputationResultDto,
  ScheduleResultDto,
  ScheduleVersionDto,
} from "@teambuddy/contracts";
import { schedule } from "@teambuddy/scheduler";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { RecalculateScheduleV1Handler } from "./recalculate-schedule-v1.js";

const teamId = randomUUID();
const memberId = randomUUID();
const projectId = randomUUID();
const milestoneId = randomUUID();
const taskId = randomUUID();

describe("RecalculateScheduleV1Handler", () => {
  it("normalizes public snapshots, derives a Shanghai horizon and persists a draft", async () => {
    const scheduleSpy = vi.fn(schedule);
    const { ports, createDraft, resolve } = createPorts();
    const handler = new RecalculateScheduleV1Handler(ports, scheduleSpy);
    const event = createEvent();

    const version = await handler.handle(event);

    expect(version.sourceEventId).toBe(event.eventId);
    expect(scheduleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2026-09-02",
        endDate: "2026-09-11",
        capacity: expect.objectContaining({
          timezone: "Asia/Shanghai",
          defaultDailyHours: 6,
          memberDailyHours: { [memberId]: 6 },
        }),
        projects: [{ id: projectId, priority: "P0", targetDate: "2026-09-08" }],
        milestones: [{ id: milestoneId, projectId, targetDate: "2026-09-11" }],
        tasks: [
          expect.objectContaining({
            id: taskId,
            projectId,
            milestoneId,
            assigneeId: memberId,
            remainingHours: 12,
          }),
        ],
        manualOverrides: [],
      }),
    );
    const computation = resolve.mock.calls[0]![1];
    expect(computation.allocations).toEqual([
      {
        taskId,
        memberId,
        date: "2026-09-02",
        hours: 6,
        source: "AUTOMATIC",
      },
      {
        taskId,
        memberId,
        date: "2026-09-04",
        hours: 6,
        source: "AUTOMATIC",
      },
    ]);
    expect(createDraft).toHaveBeenCalledWith(event.eventId, {
      teamId,
      ...computation,
    });
  });

  it("returns an immutable replay before reading live scheduling inputs", async () => {
    const existing = {
      id: randomUUID(),
      teamId,
      sourceEventId: randomUUID(),
      status: "DRAFT" as const,
      createdAt: "2026-09-02T00:00:00.000Z",
    };
    const { ports, createDraft, findBySourceEventId, resolve } = createPorts({
      existing,
    });
    const handler = new RecalculateScheduleV1Handler(ports);
    const event = { ...createEvent(), eventId: existing.sourceEventId };

    const replay = await handler.handle(event);

    expect(replay).toEqual(existing);
    expect(findBySourceEventId).toHaveBeenCalledWith(event.eventId);
    expect(ports.team.getTeam).not.toHaveBeenCalled();
    expect(ports.team.readCapacitySnapshot).not.toHaveBeenCalled();
    expect(ports.portfolio.readPortfolioSnapshot).not.toHaveBeenCalled();
    expect(ports.work.readWorkSnapshot).not.toHaveBeenCalled();
    expect(ports.manualOverrides.read).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("keeps createDraft as the concurrent read-miss fingerprint safety net", async () => {
    const { ports, createDraft, findBySourceEventId } = createPorts();
    const handler = new RecalculateScheduleV1Handler(ports);
    const event = createEvent();

    await Promise.all([handler.handle(event), handler.handle(event)]);

    expect(findBySourceEventId).toHaveBeenCalledTimes(2);
    expect(createDraft).toHaveBeenCalledTimes(2);
  });

  it("rejects a source event replay from another team before reading snapshots", async () => {
    const existing = {
      id: randomUUID(),
      teamId: randomUUID(),
      sourceEventId: randomUUID(),
      status: "DRAFT" as const,
      createdAt: "2026-09-02T00:00:00.000Z",
    };
    const { ports, createDraft, resolve } = createPorts({ existing });
    const handler = new RecalculateScheduleV1Handler(ports);
    const event = { ...createEvent(), eventId: existing.sourceEventId };

    await expect(handler.handle(event)).rejects.toMatchObject({
      code: "SOURCE_EVENT_TEAM_MISMATCH",
      referenceId: event.eventId,
    });
    expect(ports.team.getTeam).not.toHaveBeenCalled();
    expect(ports.team.readCapacitySnapshot).not.toHaveBeenCalled();
    expect(ports.portfolio.readPortfolioSnapshot).not.toHaveBeenCalled();
    expect(ports.work.readWorkSnapshot).not.toHaveBeenCalled();
    expect(ports.manualOverrides.read).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("does not extend the horizon and retains TASK_OUTSIDE_HORIZON", async () => {
    const { ports, resolve } = createPorts({ remainingHours: 60 });
    const handler = new RecalculateScheduleV1Handler(ports);

    await handler.handle(createEvent());

    expect(resolve.mock.calls[0]![1].warnings).toEqual([
      { code: "TASK_OUTSIDE_HORIZON", taskId },
    ]);
  });

  it("extends the horizon when a manual task window requests a later end date", async () => {
    const scheduleSpy = vi.fn(schedule);
    const { ports } = createPorts();
    const handler = new RecalculateScheduleV1Handler(ports, scheduleSpy);

    await handler.handle({
      ...createEvent(),
      horizonEndDate: "2026-10-30",
    });

    expect(scheduleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ endDate: "2026-10-30" }),
    );
  });

  it("ignores a stale manual override after a task is reassigned", async () => {
    const previousMemberId = randomUUID();
    const scheduleSpy = vi.fn(schedule);
    const { ports } = createPorts({
      manualOverrides: [
        {
          teamId,
          taskId,
          memberId: previousMemberId,
          date: "2026-09-02",
          hours: 6,
          locked: true,
        },
      ],
    });
    const handler = new RecalculateScheduleV1Handler(ports, scheduleSpy);

    await handler.handle(createEvent());

    expect(scheduleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ manualOverrides: [] }),
    );
  });

  it.each(["PAUSED", "COMPLETED", "CANCELED"] as const)(
    "excludes inactive members and %s projects from future schedules",
    async (projectStatus) => {
      const scheduleSpy = vi.fn(schedule);
      const { ports, resolve } = createPorts({
        memberStatus: "INACTIVE",
        projectStatus,
      });
      const handler = new RecalculateScheduleV1Handler(ports, scheduleSpy);

      await handler.handle(createEvent());

      expect(scheduleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: "2026-09-02",
          endDate: "2026-09-02",
          projects: [],
          milestones: [],
          tasks: [],
          dependencies: [],
          manualOverrides: [],
        }),
      );
      expect(resolve.mock.calls[0]![1].allocations).toEqual([]);
    },
  );

  it("rejects missing assignees without persisting guessed output", async () => {
    const { ports, createDraft } = createPorts({ includeMember: false });
    const handler = new RecalculateScheduleV1Handler(ports);

    await expect(handler.handle(createEvent())).rejects.toMatchObject({
      code: "MISSING_ASSIGNEE",
      referenceId: memberId,
    });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("propagates NoWorkingDate as a retryable failure and persists no draft", async () => {
    const { ports, createDraft } = createPorts({
      dailyHours: 0,
      exceptions: [],
    });
    const handler = new RecalculateScheduleV1Handler(ports);

    await expect(handler.handle(createEvent())).rejects.toMatchObject({
      name: "NoWorkingDateError",
      memberId,
    });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("strictly validates the versioned event before reading ports", async () => {
    const { ports } = createPorts();
    const handler = new RecalculateScheduleV1Handler(ports);

    await expect(
      handler.handle({ ...createEvent(), unexpected: true }),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(ports.planning.findBySourceEventId).not.toHaveBeenCalled();
    expect(ports.team.getTeam).not.toHaveBeenCalled();
  });
});

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase(
  "RecalculateScheduleV1Handler PostgreSQL integration",
  () => {
    const adminUrl = new URL(databaseUrl ?? "postgres://localhost");
    adminUrl.pathname = "/postgres";
    const admin = postgres(adminUrl.toString(), { max: 1 });
    const databaseName = `teambuddy_task7_handler_${randomUUID().replaceAll("-", "")}`;
    const isolatedUrl = new URL(databaseUrl ?? "postgres://localhost");
    isolatedUrl.pathname = `/${databaseName}`;
    let sql: ReturnType<typeof postgres>;
    let ports: ReturnType<typeof createBackendApplicationPorts>;

    beforeAll(async () => {
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
      await migrateBackendDatabase(isolatedUrl.toString());
      sql = postgres(isolatedUrl.toString(), { max: 1 });
      ports = createBackendApplicationPorts(isolatedUrl.toString());
      await sql`
      INSERT INTO team.teams (id, name, timezone, default_daily_hours)
      VALUES (${teamId}, '研发一组', 'Asia/Shanghai', 6)
    `;
      await sql`
      INSERT INTO team.members (id, team_id, name, status, default_daily_hours)
      VALUES (${memberId}, ${teamId}, '张三', 'ACTIVE', 6)
    `;
      await sql`
      INSERT INTO team.capacity_exceptions (member_id, date, available_hours, reason)
      VALUES (${memberId}, '2026-09-03', 0, '请假')
    `;
      await sql`
      INSERT INTO portfolio.projects (
        id, team_id, name, priority, target_date, status, health
      ) VALUES (
        ${projectId}, ${teamId}, '支付重构', 'P0', '2026-09-08', 'IN_PROGRESS', 'HEALTHY'
      )
    `;
      await sql`
      INSERT INTO portfolio.milestones (id, project_id, name, target_date)
      VALUES (${milestoneId}, ${projectId}, '联调', '2026-09-11')
    `;
      await sql`
      INSERT INTO work.tasks (
        id,
        project_id,
        milestone_id,
        assignee_id,
        name,
        estimated_hours,
        remaining_hours,
        status
      ) VALUES (
        ${taskId}, ${projectId}, ${milestoneId}, ${memberId}, '实现支付', 12, 12, 'NOT_STARTED'
      )
    `;
    });

    afterAll(async () => {
      await ports?.close();
      await sql?.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    });

    it("persists one complete draft for a replayed source event", async () => {
      const handler = new RecalculateScheduleV1Handler(ports);
      const event = createEvent();

      const first = await handler.handle(event);
      const replay = await handler.handle(event);

      expect(replay.id).toBe(first.id);
      const [count] = await sql<{ value: number }[]>`
      SELECT count(*)::int AS value
      FROM planning.schedule_versions
      WHERE source_event_id = ${event.eventId}
    `;
      expect(count?.value).toBe(1);
      const allocations = await sql<
        { date: string; hours: number; taskId: string; memberId: string }[]
      >`
      SELECT
        date::text,
        hours::float8,
        task_id AS "taskId",
        member_id AS "memberId"
      FROM planning.schedule_allocations
      WHERE schedule_version_id = ${first.id}
      ORDER BY date, member_id, task_id
    `;
      expect(allocations).toEqual([
        { date: "2026-09-02", hours: 6, taskId, memberId },
        { date: "2026-09-04", hours: 6, taskId, memberId },
      ]);
    });

    it("reads a production-persisted locked override and keeps it manual", async () => {
      await ports.manualOverrides.upsert({
        teamId,
        taskId,
        memberId,
        date: "2026-09-02",
        hours: 2,
        locked: true,
      });
      const version = await new RecalculateScheduleV1Handler(ports).handle(
        createEvent(),
      );
      const allocations = await sql<
        { source: string; hours: number; date: string }[]
      >`
      SELECT source, hours::float8 AS hours, date::text AS date
      FROM planning.schedule_allocations
      WHERE schedule_version_id = ${version.id}
      ORDER BY source, date
    `;
      expect(allocations).toContainEqual({
        source: "MANUAL",
        hours: 2,
        date: "2026-09-02",
      });
    });
  },
);

const createEvent = () => ({
  type: "planning.recalculate.requested.v1" as const,
  eventId: randomUUID(),
  correlationId: randomUUID(),
  teamId,
  requestedAt: "2026-09-01T16:00:00.000Z",
});

const createPorts = (
  options: {
    dailyHours?: number;
    exceptions?: CapacitySnapshotDto["exceptions"];
    existing?: ScheduleVersionDto;
    includeMember?: boolean;
    memberStatus?: "ACTIVE" | "INACTIVE";
    projectStatus?:
      "PLANNING" | "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "CANCELED";
    remainingHours?: number;
    manualOverrides?: Array<{
      teamId: string;
      taskId: string;
      memberId: string;
      date: string;
      hours: number;
      locked: true;
    }>;
  } = {},
) => {
  const dailyHours = options.dailyHours ?? 6;
  const members =
    options.includeMember === false
      ? []
      : [
          {
            id: memberId,
            teamId,
            name: "张三",
            status: options.memberStatus ?? ("ACTIVE" as const),
            defaultDailyHours: dailyHours,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ];
  const computationVersion = {
    id: randomUUID(),
    teamId,
    sourceEventId: "",
    status: "DRAFT" as const,
    createdAt: "2026-09-02T00:00:00.000Z",
  };
  const resolve = vi.fn(
    async (
      resolvedTeamId: string,
      computation: ScheduleComputationResultDto,
    ): Promise<ScheduleResultDto> => ({
      teamId: resolvedTeamId,
      ...computation,
    }),
  );
  const createDraft = vi.fn(
    async (
      sourceEventId: string,
      _result: ScheduleResultDto,
    ): Promise<ScheduleVersionDto> => ({
      ...computationVersion,
      sourceEventId,
    }),
  );
  const findBySourceEventId = vi.fn(async () => options.existing ?? null);
  const ports: BackendApplicationPorts = {
    team: {
      getTeam: vi.fn(async () => ({
        id: teamId,
        name: "研发一组",
        timezone: "Asia/Shanghai" as const,
        defaultDailyHours: 6,
        createdAt: "2026-08-01T00:00:00.000Z",
      })),
      readCapacitySnapshot: vi.fn(async () => ({
        team: {
          id: teamId,
          name: "研发一组",
          timezone: "Asia/Shanghai" as const,
          defaultDailyHours: 6,
          createdAt: "2026-08-01T00:00:00.000Z",
        },
        members,
        exceptions: options.exceptions ?? [
          {
            id: randomUUID(),
            memberId,
            date: "2026-09-03",
            availableHours: 0,
            reason: "请假",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      })),
    },
    portfolio: {
      readPortfolioSnapshot: vi.fn(async () => ({
        projects: [
          {
            id: projectId,
            teamId,
            name: "支付重构",
            priority: "P0" as const,
            targetDate: "2026-09-08",
            status: options.projectStatus ?? ("IN_PROGRESS" as const),
            health: "HEALTHY" as const,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        milestones: [
          {
            id: milestoneId,
            projectId,
            name: "联调",
            targetDate: "2026-09-11",
            manualRank: 0,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      })),
    },
    work: {
      readWorkSnapshot: vi.fn(async () => ({
        tasks: [
          {
            id: taskId,
            projectId,
            milestoneId,
            assigneeId: memberId,
            name: "实现支付",
            estimatedHours: options.remainingHours ?? 12,
            remainingHours: options.remainingHours ?? 12,
            status: "NOT_STARTED" as const,
            manualRank: 0,
            locked: false,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        dependencies: [],
      })),
    },
    schedulePersistence: { resolve },
    planning: { findBySourceEventId, createDraft },
    manualOverrides: {
      read: vi.fn(async () => options.manualOverrides ?? []),
      upsert: vi.fn(async (input) => input),
    },
    close: vi.fn(async () => undefined),
  };
  return { ports, createDraft, findBySourceEventId, resolve };
};
