import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  moveTaskWindow,
  resizeTaskWindow,
  ScheduleGrid,
} from "./schedule-grid.js";

const member = {
  id: "11111111-1111-4111-8111-111111111111",
  teamId: "22222222-2222-4222-8222-222222222222",
  name: "张三",
  status: "ACTIVE" as const,
  defaultDailyHours: 6,
  createdAt: "2026-09-02T00:00:00.000Z",
};

describe("ScheduleGrid", () => {
  it("renders exactly 28 Shanghai calendar days and joins adjacent task segments", () => {
    const markup = renderToStaticMarkup(
      createElement(ScheduleGrid, {
        startDate: "2026-09-07",
        members: [
          member,
          {
            ...member,
            id: "33333333-3333-4333-8333-333333333333",
            name: "李四",
          },
        ],
        projects: [
          { id: "44444444-4444-4444-8444-444444444444", name: "支付重构" },
        ],
        tasks: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            projectId: "44444444-4444-4444-8444-444444444444",
            name: "支付接口联调",
          },
        ],
        allocations: [
          {
            scheduleVersionId: "66666666-6666-4666-8666-666666666666",
            taskId: "55555555-5555-4555-8555-555555555555",
            memberId: member.id,
            date: "2026-09-07",
            hours: 6,
            source: "AUTOMATIC",
          },
          {
            scheduleVersionId: "66666666-6666-4666-8666-666666666666",
            taskId: "55555555-5555-4555-8555-555555555555",
            memberId: member.id,
            date: "2026-09-08",
            hours: 6,
            source: "AUTOMATIC",
          },
        ],
      }),
    );

    expect(markup.match(/data-calendar-day=/g) ?? []).toHaveLength(28);
    expect(markup).toContain(
      'aria-label="支付接口联调，支付重构，12h，2026-09-07 至 2026-09-08"',
    );
    expect(markup).toContain("schedule-segment--span-2");
    expect(markup).toContain("schedule-segment__labels");
    expect(markup).toContain("支付重构");
  });

  it("distinguishes weekends and renders persisted automatic weekend allocations", () => {
    const markup = renderToStaticMarkup(
      createElement(ScheduleGrid, {
        startDate: "2026-09-07",
        members: [member],
        projects: [
          { id: "44444444-4444-4444-8444-444444444444", name: "支付重构" },
        ],
        tasks: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            projectId: "44444444-4444-4444-8444-444444444444",
            name: "支付接口联调",
          },
        ],
        allocations: [
          {
            scheduleVersionId: "66666666-6666-4666-8666-666666666666",
            taskId: "55555555-5555-4555-8555-555555555555",
            memberId: member.id,
            date: "2026-09-12",
            hours: 6,
            source: "AUTOMATIC",
          },
          {
            scheduleVersionId: "66666666-6666-4666-8666-666666666666",
            taskId: "55555555-5555-4555-8555-555555555555",
            memberId: member.id,
            date: "2026-09-13",
            hours: 6,
            source: "AUTOMATIC",
          },
        ],
      }),
    );

    expect(markup).toContain("schedule-day--weekend");
    expect(markup).toContain(
      'aria-label="支付接口联调，支付重构，12h，2026-09-12 至 2026-09-13"',
    );
  });

  it("keeps one continuous task window when a weekend has no allocation", () => {
    const markup = renderToStaticMarkup(
      createElement(ScheduleGrid, {
        startDate: "2026-09-07",
        members: [member],
        projects: [
          { id: "44444444-4444-4444-8444-444444444444", name: "支付重构" },
        ],
        tasks: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            projectId: "44444444-4444-4444-8444-444444444444",
            name: "支付接口联调",
          },
        ],
        allocations: [
          {
            scheduleVersionId: "66666666-6666-4666-8666-666666666666",
            taskId: "55555555-5555-4555-8555-555555555555",
            memberId: member.id,
            date: "2026-09-11",
            hours: 6,
            source: "MANUAL",
          },
          {
            scheduleVersionId: "66666666-6666-4666-8666-666666666666",
            taskId: "55555555-5555-4555-8555-555555555555",
            memberId: member.id,
            date: "2026-09-14",
            hours: 6,
            source: "MANUAL",
          },
        ],
      }),
    );

    expect(markup).toContain("schedule-segment--span-4");
    expect(markup).toContain("2026-09-11 至 2026-09-14");
  });

  it("places overlapping projects on separate visible lanes", () => {
    const markup = renderToStaticMarkup(
      createElement(ScheduleGrid, {
        startDate: "2026-09-07",
        members: [member],
        projects: [
          { id: "44444444-4444-4444-8444-444444444444", name: "项目 A" },
          { id: "77777777-7777-4777-8777-777777777777", name: "项目 B" },
        ],
        tasks: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            projectId: "44444444-4444-4444-8444-444444444444",
            name: "任务 A",
          },
          {
            id: "88888888-8888-4888-8888-888888888888",
            projectId: "77777777-7777-4777-8777-777777777777",
            name: "任务 B",
          },
        ],
        allocations: [
          {
            scheduleVersionId: "66666666-6666-4666-8666-666666666666",
            taskId: "55555555-5555-4555-8555-555555555555",
            memberId: member.id,
            date: "2026-09-07",
            hours: 4,
            source: "AUTOMATIC",
          },
          {
            scheduleVersionId: "66666666-6666-4666-8666-666666666666",
            taskId: "88888888-8888-4888-8888-888888888888",
            memberId: member.id,
            date: "2026-09-07",
            hours: 4,
            source: "AUTOMATIC",
          },
        ],
      }),
    );

    expect(markup).toContain('data-schedule-lanes="2"');
    expect(markup).toContain('data-schedule-lane="1"');
    expect(markup).toContain('data-schedule-lane="2"');
  });

  it("moves calendar dates backward across month, year, and leap-day boundaries", () => {
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addCalendarDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addCalendarDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addCalendarDays("2026-01-01", -28)).toBe("2025-12-04");
  });

  it("moves a dragged task window without changing its calendar span", () => {
    expect(
      moveTaskWindow(
        {
          taskId: "55555555-5555-4555-8555-555555555555",
          startDate: "2026-09-07",
          endDate: "2026-09-11",
        },
        "2026-09-14",
      ),
    ).toEqual({
      taskId: "55555555-5555-4555-8555-555555555555",
      startDate: "2026-09-14",
      endDate: "2026-09-18",
    });
  });

  it("resizes either edge of a dragged task window", () => {
    const window = {
      taskId: "55555555-5555-4555-8555-555555555555",
      startDate: "2026-09-07",
      endDate: "2026-09-11",
    };

    expect(resizeTaskWindow(window, "start", "2026-09-09")).toEqual({
      ...window,
      startDate: "2026-09-09",
    });
    expect(resizeTaskWindow(window, "end", "2026-09-16")).toEqual({
      ...window,
      endDate: "2026-09-16",
    });
    expect(resizeTaskWindow(window, "start", "2026-09-12")).toBeUndefined();
    expect(resizeTaskWindow(window, "end", "2026-09-06")).toBeUndefined();
  });
});
