import { describe, expect, it } from "vitest";
import {
  InvalidScheduleInputError,
  type InvalidScheduleInputCode,
} from "./errors";
import { schedule } from "./schedule";
import type { ScheduleInput, TaskScheduleInput } from "./types";

const projects: ScheduleInput["projects"] = [
  { id: "project-p0", priority: "P0", targetDate: "2026-09-11" },
  { id: "project-p1", priority: "P1", targetDate: "2026-09-11" },
];

function task(
  id: string,
  projectId: string,
  remainingHours: number,
  overrides: Partial<TaskScheduleInput> = {},
): TaskScheduleInput {
  return {
    id,
    projectId,
    assigneeId: "member",
    remainingHours,
    status: "NOT_STARTED",
    manualRank: 0,
    ...overrides,
  };
}

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    startDate: "2026-09-07",
    endDate: "2026-09-18",
    capacity: {
      timezone: "Asia/Shanghai",
      defaultDailyHours: 6,
      memberDailyHours: {},
      exceptions: [],
    },
    projects,
    milestones: [],
    tasks: [],
    dependencies: [],
    manualOverrides: [],
    ...overrides,
  };
}

function expectInvalidSchedule(
  inputValue: ScheduleInput,
  code: InvalidScheduleInputCode,
): void {
  expect(() => schedule(inputValue)).toThrowError(
    new InvalidScheduleInputError(code),
  );
}

describe("schedule", () => {
  it("allocates a P0 task before a P1 task even when P1 was created first", () => {
    const result = schedule(
      input({
        tasks: [
          task("p1-first", "project-p1", 6),
          task("p0-second", "project-p0", 6),
        ],
      }),
    );

    expect(
      result.allocations.map(({ taskId, date }) => [taskId, date]),
    ).toEqual([
      ["p0-second", "2026-09-07"],
      ["p1-first", "2026-09-08"],
    ]);
  });

  it("starts a successor after its predecessor completes", () => {
    const result = schedule(
      input({
        tasks: [
          task("successor", "project-p0", 6),
          task("predecessor", "project-p0", 6),
        ],
        dependencies: [
          { predecessorTaskId: "predecessor", successorTaskId: "successor" },
        ],
      }),
    );

    expect(result.taskDates).toMatchObject({
      predecessor: { start: "2026-09-07", end: "2026-09-07" },
      successor: { start: "2026-09-08", end: "2026-09-08" },
    });
  });

  it("splits a 10-hour task into 6 hours and 4 hours across two days", () => {
    const result = schedule(
      input({ tasks: [task("large", "project-p0", 10)] }),
    );

    expect(result.allocations).toEqual([
      {
        taskId: "large",
        memberId: "member",
        date: "2026-09-07",
        hours: 6,
        source: "AUTOMATIC",
      },
      {
        taskId: "large",
        memberId: "member",
        date: "2026-09-08",
        hours: 4,
        source: "AUTOMATIC",
      },
    ]);
  });

  it("does not interleave two automatic tasks on the same member and day", () => {
    const result = schedule(
      input({
        tasks: [task("A", "project-p0", 4), task("B", "project-p0", 4)],
      }),
    );

    expect(result.allocations).toEqual([
      {
        taskId: "A",
        memberId: "member",
        date: "2026-09-07",
        hours: 4,
        source: "AUTOMATIC",
      },
      {
        taskId: "B",
        memberId: "member",
        date: "2026-09-08",
        hours: 4,
        source: "AUTOMATIC",
      },
    ]);
  });

  it("lets a locked manual override share a day with an automatic task", () => {
    const result = schedule(
      input({
        tasks: [
          task("manual", "project-p0", 2),
          task("automatic", "project-p1", 4),
        ],
        manualOverrides: [
          {
            taskId: "manual",
            memberId: "member",
            date: "2026-09-07",
            hours: 2,
            locked: true,
          },
        ],
      }),
    );

    expect(result.allocations).toEqual([
      {
        taskId: "automatic",
        memberId: "member",
        date: "2026-09-07",
        hours: 4,
        source: "AUTOMATIC",
      },
      {
        taskId: "manual",
        memberId: "member",
        date: "2026-09-07",
        hours: 2,
        source: "MANUAL",
      },
    ]);
  });

  it("keeps historical manual work while automatic work still starts at the horizon", () => {
    const result = schedule(
      input({
        tasks: [task("historical", "project-p0", 12)],
        manualOverrides: [
          {
            taskId: "historical",
            memberId: "member",
            date: "2026-09-01",
            hours: 6,
            locked: true,
          },
        ],
      }),
    );

    expect(result.allocations).toEqual([
      {
        taskId: "historical",
        memberId: "member",
        date: "2026-09-01",
        hours: 6,
        source: "MANUAL",
      },
      {
        taskId: "historical",
        memberId: "member",
        date: "2026-09-07",
        hours: 6,
        source: "AUTOMATIC",
      },
    ]);
  });

  it("skips a zero-capacity exception", () => {
    const result = schedule(
      input({
        capacity: {
          timezone: "Asia/Shanghai",
          defaultDailyHours: 6,
          memberDailyHours: {},
          exceptions: [
            { memberId: "member", date: "2026-09-07", availableHours: 0 },
          ],
        },
        tasks: [task("leave-aware", "project-p0", 6)],
      }),
    );

    expect(result.allocations[0]?.date).toBe("2026-09-08");
  });

  it("does not allocate completed or canceled tasks", () => {
    const result = schedule(
      input({
        tasks: [
          task("completed", "project-p0", 6, { status: "COMPLETED" }),
          task("canceled", "project-p0", 6, { status: "CANCELED" }),
        ],
      }),
    );

    expect(result).toEqual({ allocations: [], taskDates: {}, warnings: [] });
  });

  it("does not allocate blocked tasks or unlock their successors", () => {
    const result = schedule(
      input({
        tasks: [
          task("blocked", "project-p0", 6, { status: "BLOCKED" }),
          task("successor", "project-p0", 6),
        ],
        dependencies: [
          { predecessorTaskId: "blocked", successorTaskId: "successor" },
        ],
      }),
    );

    expect(result.allocations).toEqual([]);
    expect(result.warnings).toContainEqual({
      code: "TASK_BLOCKED",
      taskId: "blocked",
    });
    expect(result.taskDates).not.toHaveProperty("successor");
  });

  it("does not let a successor override bypass a blocked dependency or unlock downstream work", () => {
    expectInvalidSchedule(
      input({
        tasks: [
          task("A", "project-p0", 6, { status: "BLOCKED" }),
          task("B", "project-p0", 6),
          task("C", "project-p0", 6),
        ],
        dependencies: [
          { predecessorTaskId: "A", successorTaskId: "B" },
          { predecessorTaskId: "B", successorTaskId: "C" },
        ],
        manualOverrides: [
          {
            taskId: "B",
            memberId: "member",
            date: "2026-09-08",
            hours: 6,
            locked: true,
          },
        ],
      }),
      "MANUAL_OVERRIDE_UNSATISFIED",
    );
  });

  it("rejects a manual override before all dependencies have completed", () => {
    expectInvalidSchedule(
      input({
        tasks: [task("A", "project-p0", 12), task("B", "project-p0", 6)],
        dependencies: [{ predecessorTaskId: "A", successorTaskId: "B" }],
        manualOverrides: [
          {
            taskId: "B",
            memberId: "member",
            date: "2026-09-08",
            hours: 6,
            locked: true,
          },
        ],
      }),
      "MANUAL_OVERRIDE_BEFORE_EARLIEST_START",
    );
  });

  it("falls back to the project target date when a task has no milestone", () => {
    const result = schedule(
      input({
        projects: [
          { id: "later", priority: "P0", targetDate: "2026-09-18" },
          { id: "earlier", priority: "P0", targetDate: "2026-09-11" },
        ],
        tasks: [
          task("later-task", "later", 6),
          task("earlier-task", "earlier", 6),
        ],
      }),
    );

    expect(result.allocations.map(({ taskId }) => taskId)).toEqual([
      "earlier-task",
      "later-task",
    ]);
  });

  it("retains unallocated work and warns when no working date exists in the horizon", () => {
    const result = schedule(
      input({
        capacity: {
          timezone: "Asia/Shanghai",
          defaultDailyHours: 0,
          memberDailyHours: {},
          exceptions: [],
        },
        tasks: [task("unscheduled", "project-p0", 6)],
      }),
    );

    expect(result.allocations).toEqual([]);
    expect(result.taskDates).toEqual({});
    expect(result.warnings).toContainEqual({
      code: "TASK_OUTSIDE_HORIZON",
      taskId: "unscheduled",
    });
  });

  it("allows distinct tasks to have locked overrides on the same member and date", () => {
    const result = schedule(
      input({
        tasks: [task("A", "project-p0", 2), task("B", "project-p0", 3)],
        manualOverrides: [
          {
            taskId: "B",
            memberId: "member",
            date: "2026-09-07",
            hours: 3,
            locked: true,
          },
          {
            taskId: "A",
            memberId: "member",
            date: "2026-09-07",
            hours: 2,
            locked: true,
          },
        ],
      }),
    );

    expect(result.allocations).toEqual([
      {
        taskId: "A",
        memberId: "member",
        date: "2026-09-07",
        hours: 2,
        source: "MANUAL",
      },
      {
        taskId: "B",
        memberId: "member",
        date: "2026-09-07",
        hours: 3,
        source: "MANUAL",
      },
    ]);
  });

  it.each([
    {
      code: "UNKNOWN_PROJECT" as const,
      value: input({ tasks: [task("A", "missing-project", 1)] }),
    },
    {
      code: "UNKNOWN_MILESTONE" as const,
      value: input({
        tasks: [task("A", "project-p0", 1, { milestoneId: "missing" })],
      }),
    },
    {
      code: "UNKNOWN_DEPENDENCY_TASK" as const,
      value: input({
        tasks: [task("A", "project-p0", 1)],
        dependencies: [{ predecessorTaskId: "missing", successorTaskId: "A" }],
      }),
    },
    {
      code: "UNKNOWN_OVERRIDE_TASK" as const,
      value: input({
        manualOverrides: [
          {
            taskId: "missing",
            memberId: "member",
            date: "2026-09-07",
            hours: 1,
            locked: true,
          },
        ],
      }),
    },
  ])("rejects invalid reference with $code", ({ code, value }) => {
    expectInvalidSchedule(value, code);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    0,
  ])("rejects invalid manual override hours: %s", (hours) => {
    expectInvalidSchedule(
      input({
        tasks: [task("A", "project-p0", 6)],
        manualOverrides: [
          {
            taskId: "A",
            memberId: "member",
            date: "2026-09-07",
            hours,
            locked: true,
          },
        ],
      }),
      "INVALID_OVERRIDE_HOURS",
    );
  });

  it("rejects a manual override assigned to a different member", () => {
    expectInvalidSchedule(
      input({
        tasks: [task("A", "project-p0", 6)],
        manualOverrides: [
          {
            taskId: "A",
            memberId: "other",
            date: "2026-09-07",
            hours: 1,
            locked: true,
          },
        ],
      }),
      "OVERRIDE_ASSIGNEE_MISMATCH",
    );
  });

  it("rejects total manual hours above the task remaining hours", () => {
    expectInvalidSchedule(
      input({
        tasks: [task("A", "project-p0", 6)],
        manualOverrides: [
          {
            taskId: "A",
            memberId: "member",
            date: "2026-09-07",
            hours: 4,
            locked: true,
          },
          {
            taskId: "A",
            memberId: "member",
            date: "2026-09-08",
            hours: 3,
            locked: true,
          },
        ],
      }),
      "MANUAL_HOURS_EXCEED_REMAINING",
    );
  });

  it.each(["BLOCKED", "COMPLETED", "CANCELED"] as const)(
    "rejects a manual override on a %s task",
    (status) => {
      expectInvalidSchedule(
        input({
          tasks: [task("A", "project-p0", 6, { status })],
          manualOverrides: [
            {
              taskId: "A",
              memberId: "member",
              date: "2026-09-07",
              hours: 1,
              locked: true,
            },
          ],
        }),
        "OVERRIDE_INVALID_TASK_STATUS",
      );
    },
  );

  it("rejects duplicate manual overrides with the same stable error after reversal", () => {
    const overrides: ScheduleInput["manualOverrides"] = [
      {
        taskId: "A",
        memberId: "member",
        date: "2026-09-07",
        hours: 1,
        locked: true,
      },
      {
        taskId: "A",
        memberId: "member",
        date: "2026-09-07",
        hours: 2,
        locked: true,
      },
    ];
    const getError = (manualOverrides: ScheduleInput["manualOverrides"]) => {
      try {
        schedule(
          input({ tasks: [task("A", "project-p0", 6)], manualOverrides }),
        );
      } catch (error) {
        return error;
      }
      throw new Error("Expected invalid schedule input");
    };

    expect(getError(overrides)).toEqual(getError([...overrides].reverse()));
    expectInvalidSchedule(
      input({
        tasks: [task("A", "project-p0", 6)],
        manualOverrides: overrides,
      }),
      "DUPLICATE_MANUAL_OVERRIDE",
    );
  });

  it("rejects duplicate capacity exceptions with the same stable error after reversal", () => {
    const exceptions: ScheduleInput["capacity"]["exceptions"] = [
      { memberId: "member", date: "2026-09-07", availableHours: 0 },
      { memberId: "member", date: "2026-09-07", availableHours: 4 },
    ];
    const value = (
      orderedExceptions: ScheduleInput["capacity"]["exceptions"],
    ) =>
      input({
        capacity: {
          timezone: "Asia/Shanghai",
          defaultDailyHours: 6,
          memberDailyHours: {},
          exceptions: orderedExceptions,
        },
      });
    const getError = (
      orderedExceptions: ScheduleInput["capacity"]["exceptions"],
    ) => {
      try {
        schedule(value(orderedExceptions));
      } catch (error) {
        return error;
      }
      throw new Error("Expected invalid schedule input");
    };

    expect(getError(exceptions)).toEqual(getError([...exceptions].reverse()));
    expectInvalidSchedule(value(exceptions), "DUPLICATE_CAPACITY_EXCEPTION");
  });

  it("produces byte-for-byte identical output when every input array is reversed", () => {
    const deterministicInput = input({
      projects: [...projects],
      milestones: [
        { id: "late", projectId: "project-p0", targetDate: "2026-09-18" },
        { id: "early", projectId: "project-p0", targetDate: "2026-09-11" },
      ],
      tasks: [
        task("B", "project-p0", 4, { milestoneId: "late", manualRank: 1 }),
        task("A", "project-p0", 8, { milestoneId: "early" }),
      ],
      dependencies: [{ predecessorTaskId: "A", successorTaskId: "B" }],
      manualOverrides: [
        {
          taskId: "A",
          memberId: "member",
          date: "2026-09-07",
          hours: 2,
          locked: true,
        },
      ],
    });
    const reversedInput: ScheduleInput = {
      ...deterministicInput,
      capacity: {
        ...deterministicInput.capacity,
        exceptions: [...deterministicInput.capacity.exceptions].reverse(),
      },
      projects: [...deterministicInput.projects].reverse(),
      milestones: [...deterministicInput.milestones].reverse(),
      tasks: [...deterministicInput.tasks].reverse(),
      dependencies: [...deterministicInput.dependencies].reverse(),
      manualOverrides: [...deterministicInput.manualOverrides].reverse(),
    };

    expect(JSON.stringify(schedule(deterministicInput))).toBe(
      JSON.stringify(schedule(reversedInput)),
    );
  });
});
