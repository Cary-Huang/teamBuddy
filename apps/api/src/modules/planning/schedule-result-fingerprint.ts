import { createHash } from "node:crypto";

import type { ScheduleResultDto } from "@teambuddy/contracts";

export const scheduleResultFingerprint = (
  result: ScheduleResultDto,
): string => {
  const canonicalResult = {
    teamId: result.teamId,
    allocations: [...result.allocations]
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          left.memberId.localeCompare(right.memberId) ||
          left.taskId.localeCompare(right.taskId) ||
          left.source.localeCompare(right.source) ||
          left.hours - right.hours,
      )
      .map(({ taskId, memberId, date, hours, source }) => ({
        taskId,
        memberId,
        date,
        hours,
        source,
      })),
    taskDates: Object.keys(result.taskDates)
      .sort()
      .map((taskId) => ({
        taskId,
        start: result.taskDates[taskId]?.start ?? null,
        end: result.taskDates[taskId]?.end ?? null,
      })),
    warnings: [...result.warnings]
      .sort(
        (left, right) =>
          left.taskId.localeCompare(right.taskId) ||
          left.code.localeCompare(right.code),
      )
      .map(({ code, taskId }) => ({ code, taskId })),
  };

  return createHash("sha256")
    .update(JSON.stringify(canonicalResult))
    .digest("hex");
};
