import { describe, expect, it } from "vitest";

import {
  buildTaskWindowOverrides,
  calculateAdjustedTaskEffort,
} from "./planning.service.js";

const task = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  assigneeId: "33333333-3333-4333-8333-333333333333",
  name: "支付接口联调",
  estimatedHours: 12,
  remainingHours: 12,
  status: "NOT_STARTED" as const,
  manualRank: 0,
  locked: false,
  createdAt: "2026-09-02T00:00:00.000Z",
};

const capacity = {
  team: {
    id: "44444444-4444-4444-8444-444444444444",
    name: "研发一组",
    timezone: "Asia/Shanghai" as const,
    defaultDailyHours: 6,
    createdAt: "2026-09-02T00:00:00.000Z",
  },
  members: [
    {
      id: task.assigneeId,
      teamId: "44444444-4444-4444-8444-444444444444",
      name: "张三",
      status: "ACTIVE" as const,
      defaultDailyHours: 6,
      createdAt: "2026-09-02T00:00:00.000Z",
    },
  ],
  exceptions: [],
};

describe("buildTaskWindowOverrides", () => {
  it("spreads remaining work across every working day in the chosen window", () => {
    expect(
      buildTaskWindowOverrides(task, capacity, {
        startDate: "2026-09-07",
        endDate: "2026-09-11",
      }),
    ).toEqual([
      { date: "2026-09-07", hours: 2.4 },
      { date: "2026-09-08", hours: 2.4 },
      { date: "2026-09-09", hours: 2.4 },
      { date: "2026-09-10", hours: 2.4 },
      { date: "2026-09-11", hours: 2.4 },
    ]);
  });

  it("honors weekends and member capacity exceptions", () => {
    expect(
      buildTaskWindowOverrides(
        { ...task, remainingHours: 8 },
        {
          ...capacity,
          exceptions: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              memberId: task.assigneeId,
              date: "2026-09-08",
              availableHours: 2,
              createdAt: "2026-09-02T00:00:00.000Z",
            },
          ],
        },
        { startDate: "2026-09-05", endDate: "2026-09-08" },
      ),
    ).toEqual([
      { date: "2026-09-07", hours: 6 },
      { date: "2026-09-08", hours: 2 },
    ]);
  });

  it("rejects a window without enough available capacity", () => {
    expect(() =>
      buildTaskWindowOverrides({ ...task, remainingHours: 13 }, capacity, {
        startDate: "2026-09-07",
        endDate: "2026-09-08",
      }),
    ).toThrowError(expect.objectContaining({ code: "TASK_WINDOW_TOO_SHORT" }));
  });

  it("rejects blocked or finished work", () => {
    for (const status of ["BLOCKED", "COMPLETED", "CANCELED"] as const) {
      expect(() =>
        buildTaskWindowOverrides({ ...task, status }, capacity, {
          startDate: "2026-09-07",
          endDate: "2026-09-11",
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "TASK_STATUS_NOT_SCHEDULABLE",
        }),
      );
    }
  });
});

describe("calculateAdjustedTaskEffort", () => {
  it("uses working-day capacity and preserves completed effort", () => {
    expect(
      calculateAdjustedTaskEffort(
        { ...task, estimatedHours: 12, remainingHours: 9 },
        {
          ...capacity,
          team: { ...capacity.team, defaultDailyHours: 8 },
          members: [{ ...capacity.members[0]!, defaultDailyHours: 8 }],
          exceptions: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              memberId: task.assigneeId,
              date: "2026-09-08",
              availableHours: 4,
              createdAt: "2026-09-02T00:00:00.000Z",
            },
          ],
        },
        { startDate: "2026-09-07", endDate: "2026-09-09" },
      ),
    ).toEqual({ estimatedHours: 20, remainingHours: 17 });
  });

  it("does not allow a resized window shorter than completed effort", () => {
    expect(() =>
      calculateAdjustedTaskEffort(
        { ...task, estimatedHours: 12, remainingHours: 2 },
        {
          ...capacity,
          team: { ...capacity.team, defaultDailyHours: 8 },
          members: [{ ...capacity.members[0]!, defaultDailyHours: 8 }],
        },
        { startDate: "2026-09-07", endDate: "2026-09-07" },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "TASK_WINDOW_BEFORE_COMPLETED_WORK" }),
    );
  });
});
