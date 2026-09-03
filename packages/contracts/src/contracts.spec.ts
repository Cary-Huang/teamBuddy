import { describe, expect, it } from "vitest";
import {
  apiErrorResponseSchema,
  capacityExceptionSchema,
  createMemberRequestSchema,
  createMilestoneRequestSchema,
  createProjectRequestSchema,
  createTaskRequestSchema,
  createTagGroupRequestSchema,
  createTagRequestSchema,
  createTaskDependencyRequestSchema,
  createTeamSchema,
  dateKeySchema,
  memberSchema,
  memberListSchema,
  milestoneSchema,
  projectDetailSchema,
  projectPrioritySchema,
  projectSchema,
  recalculateScheduleRequestedV1Schema,
  scheduleAllocationInputSchema,
  scheduleAllocationSchema,
  scheduleResultSchema,
  scheduleVersionSchema,
  scheduleVersionWithAllocationsSchema,
  queuedRecalculationSchema,
  taskStatusSchema,
  taskScheduleWindowRequestSchema,
  taskDependencySchema,
  taskSchema,
  teamSchema,
  updateMemberSchema,
  updateMilestoneSchema,
  updateProjectSchema,
  updateTaskSchema,
  upsertCapacityExceptionRequestSchema,
} from "./index";

describe("public contracts", () => {
  it("accepts only the four project priorities", () => {
    expect(projectPrioritySchema.options).toEqual(["P0", "P1", "P2", "P3"]);
    expect(projectPrioritySchema.safeParse("P4").success).toBe(false);
  });

  it("defaults new teams to an eight-hour workday", () => {
    expect(
      createTeamSchema.parse({
        name: "研发一组",
        timezone: "Asia/Shanghai",
      }).defaultDailyHours,
    ).toBe(8);
  });

  it("defines stable tag codes and validated display colors", () => {
    const group = createTagGroupRequestSchema.parse({
      code: "work_type",
      name: "工作类型",
      selectionMode: "SINGLE",
      scope: "BOTH",
    });
    expect(group).toMatchObject({ code: "work_type" });
    expect(group).not.toHaveProperty("requiredOnProject");
    expect(
      createTagRequestSchema.safeParse({
        groupId: "742ba5e7-3545-4628-82bf-6db5a3634b35",
        code: "BugFix",
        name: "Bugfix",
      }).success,
    ).toBe(false);
    expect(
      createTagRequestSchema.safeParse({
        groupId: "742ba5e7-3545-4628-82bf-6db5a3634b35",
        code: "bugfix",
        name: "Bugfix",
        color: "red",
      }).success,
    ).toBe(false);
  });

  it("accepts the fixed task states", () => {
    expect(taskStatusSchema.options).toEqual([
      "NOT_STARTED",
      "IN_PROGRESS",
      "BLOCKED",
      "COMPLETED",
      "CANCELED",
    ]);
  });

  it("requires version and correlation metadata on schedule requests", () => {
    const parsed = recalculateScheduleRequestedV1Schema.parse({
      type: "planning.recalculate.requested.v1",
      eventId: "d23887f6-e82d-4785-9958-ce813beff5a8",
      correlationId: "5d1aa77e-9e67-4bd0-a753-6061681bd5eb",
      teamId: "742ba5e7-3545-4628-82bf-6db5a3634b35",
      requestedAt: "2026-09-02T02:00:00.000Z",
    });
    expect(parsed.type).toBe("planning.recalculate.requested.v1");
  });

  it("defines a strict, ordered task schedule window", () => {
    expect(
      taskScheduleWindowRequestSchema.parse({
        startDate: "2026-09-07",
        endDate: "2026-09-11",
        adjustTaskHours: true,
      }),
    ).toEqual({
      startDate: "2026-09-07",
      endDate: "2026-09-11",
      adjustTaskHours: true,
    });
    expect(
      taskScheduleWindowRequestSchema.safeParse({
        startDate: "2026-09-12",
        endDate: "2026-09-11",
      }).success,
    ).toBe(false);
    expect(
      taskScheduleWindowRequestSchema.safeParse({
        startDate: "2026-09-07",
        endDate: "2026-09-11",
        hours: 12,
      }).success,
    ).toBe(false);
  });

  it("allows a schedule request to extend its calculation horizon", () => {
    const parsed = recalculateScheduleRequestedV1Schema.parse({
      type: "planning.recalculate.requested.v1",
      eventId: "d23887f6-e82d-4785-9958-ce813beff5a8",
      correlationId: "5d1aa77e-9e67-4bd0-a753-6061681bd5eb",
      teamId: "742ba5e7-3545-4628-82bf-6db5a3634b35",
      requestedAt: "2026-09-02T02:00:00.000Z",
      horizonEndDate: "2026-10-30",
    });
    expect(parsed.horizonEndDate).toBe("2026-10-30");
  });

  it("separates computed allocations from persisted allocations", () => {
    const input = {
      taskId: "5be1c4bb-5f09-4f94-91c8-99edcd14bb79",
      memberId: "990b097c-5e46-45ae-8e74-345171cc7550",
      date: "2026-09-03",
      hours: 6,
      source: "AUTOMATIC" as const,
    };

    expect(scheduleAllocationInputSchema.parse(input)).toEqual(input);
    expect(
      scheduleAllocationInputSchema.safeParse({
        ...input,
        scheduleVersionId: "fa82cb2d-88f4-445c-bf7e-fb7d6a813dbd",
      }).success,
    ).toBe(false);
    expect(scheduleAllocationSchema.safeParse(input).success).toBe(false);
  });

  it("requires resolved team scope before schedule persistence", () => {
    const result = scheduleResultSchema.parse({
      teamId: "742ba5e7-3545-4628-82bf-6db5a3634b35",
      allocations: [],
      taskDates: {},
      warnings: [],
    });

    expect(result.teamId).toBe("742ba5e7-3545-4628-82bf-6db5a3634b35");
  });

  it("defines strict path-scoped HTTP mutation bodies", () => {
    const scopedBodies = [
      [createMemberRequestSchema, { name: "张三" }],
      [
        createProjectRequestSchema,
        { name: "支付重构", priority: "P0", targetDate: "2026-09-18" },
      ],
      [
        createMilestoneRequestSchema,
        { name: "联调完成", targetDate: "2026-09-11" },
      ],
      [
        createTaskRequestSchema,
        {
          assigneeId: "990b097c-5e46-45ae-8e74-345171cc7550",
          name: "支付接口联调",
          estimatedHours: 12,
          remainingHours: 12,
        },
      ],
      [
        createTaskDependencyRequestSchema,
        { predecessorTaskId: "5be1c4bb-5f09-4f94-91c8-99edcd14bb79" },
      ],
      [
        upsertCapacityExceptionRequestSchema,
        { availableHours: 0, reason: "请假" },
      ],
    ] as const;

    for (const [schema, body] of scopedBodies) {
      expect(schema.safeParse(body).success).toBe(true);
      expect(schema.safeParse({ ...body, unexpected: true }).success).toBe(
        false,
      );
    }
    expect(
      createMemberRequestSchema.safeParse({
        teamId: "742ba5e7-3545-4628-82bf-6db5a3634b35",
        name: "张三",
      }).success,
    ).toBe(false);
  });

  it("validates the public project detail response without database keys", () => {
    const detail = projectDetailSchema.parse({
      project: {
        id: "87c53b5a-0b64-49ca-a9b1-54ed2e06f4d3",
        teamId: "742ba5e7-3545-4628-82bf-6db5a3634b35",
        name: "支付重构",
        priority: "P0",
        targetDate: "2026-09-18",
        status: "PLANNING",
        health: "HEALTHY",
        createdAt: "2026-09-02T02:00:00.000Z",
      },
      milestones: [],
      tasks: [],
    });

    expect(detail.project.name).toBe("支付重构");
    expect(
      projectDetailSchema.safeParse({ ...detail, created_at: "leak" }).success,
    ).toBe(false);
  });

  it("defines the stable strict API error envelope", () => {
    const error = apiErrorResponseSchema.parse({
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: { field: "priority" },
      correlationId: "5d1aa77e-9e67-4bd0-a753-6061681bd5eb",
    });
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(
      apiErrorResponseSchema.safeParse({ ...error, stack: "private" }).success,
    ).toBe(false);
  });

  it("publishes list and latest-schedule response schemas used by the web client", () => {
    const member = {
      id: "990b097c-5e46-45ae-8e74-345171cc7550",
      teamId: "742ba5e7-3545-4628-82bf-6db5a3634b35",
      name: "张三",
      status: "ACTIVE" as const,
      defaultDailyHours: 6,
      createdAt: "2026-09-02T02:00:00.000Z",
    };
    expect(memberListSchema.parse([member])).toEqual([member]);
    expect(
      queuedRecalculationSchema.parse({
        eventId: "5be1c4bb-5f09-4f94-91c8-99edcd14bb79",
        status: "queued",
      }).status,
    ).toBe("queued");
    expect(
      scheduleVersionWithAllocationsSchema.parse({
        id: "fa82cb2e-88f4-445c-bf7e-fb7d6a813dbd",
        teamId: member.teamId,
        sourceEventId: "5be1c4bb-5f09-4f94-91c8-99edcd14bb79",
        status: "DRAFT",
        createdAt: "2026-09-02T02:00:00.000Z",
        allocations: [],
      }).allocations,
    ).toEqual([]);
  });

  it("accepts only canonical real Gregorian dates", () => {
    expect(dateKeySchema.safeParse("2024-02-29").success).toBe(true);
    for (const invalid of [
      "2026-02-29",
      "2026-04-31",
      "2026-13-01",
      "0000-01-01",
      "2026-9-01",
    ]) {
      expect(dateKeySchema.safeParse(invalid).success, invalid).toBe(false);
    }
  });

  it("rejects unknown fields in public response objects", () => {
    const ids = {
      team: "742ba5e7-3545-4628-82bf-6db5a3634b35",
      member: "990b097c-5e46-45ae-8e74-345171cc7550",
      project: "87c53b5a-0b64-49ca-a9b1-54ed2e06f4d3",
      milestone: "c38812e8-7bff-45df-b1fc-0ad4e0d00d50",
      task: "5be1c4bb-5f09-4f94-91c8-99edcd14bb79",
      predecessor: "e69a41ec-e3e2-4df7-98fc-2f30007983e2",
    };
    const createdAt = "2026-09-02T02:00:00.000Z";
    const responses = [
      [
        teamSchema,
        {
          id: ids.team,
          name: "研发一组",
          timezone: "Asia/Shanghai",
          defaultDailyHours: 6,
          createdAt,
        },
      ],
      [
        memberSchema,
        {
          id: ids.member,
          teamId: ids.team,
          name: "张三",
          status: "ACTIVE",
          defaultDailyHours: 6,
          createdAt,
        },
      ],
      [
        projectSchema,
        {
          id: ids.project,
          teamId: ids.team,
          name: "支付重构",
          priority: "P0",
          targetDate: "2026-09-18",
          status: "PLANNING",
          health: "HEALTHY",
          createdAt,
        },
      ],
      [
        milestoneSchema,
        {
          id: ids.milestone,
          projectId: ids.project,
          name: "联调完成",
          targetDate: "2026-09-11",
          manualRank: 0,
          createdAt,
        },
      ],
      [
        taskSchema,
        {
          id: ids.task,
          projectId: ids.project,
          assigneeId: ids.member,
          name: "支付接口联调",
          estimatedHours: 12,
          remainingHours: 12,
          status: "NOT_STARTED",
          manualRank: 0,
          locked: false,
          createdAt,
        },
      ],
      [
        taskDependencySchema,
        {
          predecessorTaskId: ids.predecessor,
          successorTaskId: ids.task,
        },
      ],
      [
        capacityExceptionSchema,
        {
          id: "9a66f462-8f7d-4a80-83ba-72e94551de99",
          memberId: ids.member,
          date: "2026-09-04",
          availableHours: 0,
          createdAt,
        },
      ],
      [
        scheduleVersionSchema,
        {
          id: "fa82cb2d-88f4-445c-bf7e-fb7d6a813dbd",
          teamId: ids.team,
          sourceEventId: "d23887f6-e82d-4785-9958-ce813beff5a8",
          status: "DRAFT",
          createdAt,
        },
      ],
    ] as const;

    for (const [schema, value] of responses) {
      expect(schema.safeParse(value).success).toBe(true);
      expect(
        schema.safeParse({ ...value, created_at: createdAt }).success,
      ).toBe(false);
    }
    expect(
      projectDetailSchema.safeParse({
        project: { ...responses[2][1], created_at: createdAt },
        milestones: [],
        tasks: [],
      }).success,
    ).toBe(false);
  });

  it("rejects empty PATCH bodies", () => {
    for (const schema of [
      updateMemberSchema,
      updateProjectSchema,
      updateMilestoneSchema,
      updateTaskSchema,
    ]) {
      expect(schema.safeParse({}).success).toBe(false);
    }
  });
});
