"use client";

import type { MemberDto, ScheduleAllocationDto } from "@teambuddy/contracts";
import type { DragEvent, KeyboardEvent } from "react";

export interface ScheduleGridProps {
  startDate: string;
  members: Array<Pick<MemberDto, "id" | "name" | "defaultDailyHours">>;
  projects: Array<{ id: string; name: string }>;
  tasks: Array<{ id: string; projectId: string; name: string }>;
  allocations: ScheduleAllocationDto[];
  disabled?: boolean;
  onEditTask?: (window: TaskWindowChange) => void;
  onMoveTask?: (
    window: TaskWindowChange,
    operation: TaskWindowDragOperation,
  ) => void;
}

export type TaskWindowDragOperation = "move" | "resize";

export interface TaskWindowChange {
  taskId: string;
  startDate: string;
  endDate: string;
}

interface Segment {
  taskId: string;
  startIndex: number;
  length: number;
  hours: number;
  startDate: string;
  endDate: string;
  lane: number;
}

export function ScheduleGrid({
  startDate,
  members,
  projects,
  tasks,
  allocations,
  disabled = false,
  onEditTask,
  onMoveTask,
}: ScheduleGridProps) {
  const days = buildCalendarDays(startDate);
  const projectsById = new Map(
    projects.map((project) => [project.id, project]),
  );
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  return (
    <section className="schedule-grid" aria-label="四周团队排期">
      <div className="schedule-grid__scroller">
        <div className="schedule-grid__table">
          <div className="schedule-grid__header">
            <div className="schedule-grid__member-heading">成员</div>
            <div className="schedule-grid__day-columns">
              {days.map((day) => (
                <div
                  className={`schedule-day${day.weekend ? " schedule-day--weekend" : ""}`}
                  data-calendar-day={day.date}
                  key={day.date}
                >
                  <span>{day.weekday}</span>
                  <strong>{day.date.slice(8)}</strong>
                </div>
              ))}
            </div>
          </div>
          {members.length === 0 ? (
            <p className="empty-state">尚无成员，先在团队成员页创建成员。</p>
          ) : (
            members.map((member) => {
              const segments = buildSegments(
                allocations.filter(
                  (allocation) => allocation.memberId === member.id,
                ),
                days,
              );
              const laneCount = Math.max(
                1,
                ...segments.map(({ lane }) => lane + 1),
              );
              return (
                <div className="schedule-grid__member-row" key={member.id}>
                  <div className="schedule-grid__member" title={member.name}>
                    <strong>{member.name}</strong>
                    <span>{member.defaultDailyHours ?? 0}h/日</span>
                  </div>
                  <div
                    className="schedule-grid__timeline"
                    data-schedule-lanes={laneCount}
                    style={{
                      gridTemplateRows: `repeat(${laneCount}, 36px)`,
                      minHeight: Math.max(60, laneCount * 36),
                    }}
                  >
                    {days.map((day) => (
                      <div
                        aria-label={`${member.name} ${day.date}${day.weekend ? "，周末" : ""}`}
                        className={`schedule-cell${day.weekend ? " schedule-day--weekend" : ""}`}
                        key={day.date}
                        onDragOver={(event) => {
                          if (!disabled) event.preventDefault();
                        }}
                        onDrop={(event) => {
                          const payload = readDragPayload(event);
                          if (
                            disabled ||
                            !payload ||
                            payload.memberId !== member.id
                          ) {
                            return;
                          }
                          event.preventDefault();
                          const result = applyDraggedTaskWindow(
                            payload,
                            day.date,
                          );
                          if (result) {
                            onMoveTask?.(result.window, result.operation);
                          }
                        }}
                        style={{ gridRow: `1 / span ${laneCount}` }}
                      />
                    ))}
                    {segments.map((segment) => {
                      const task = tasksById.get(segment.taskId);
                      const project = task
                        ? projectsById.get(task.projectId)
                        : undefined;
                      const label = `${task?.name ?? "未知任务"}，${project?.name ?? "未知项目"}，${formatHours(segment.hours)}，${segment.startDate} 至 ${segment.endDate}`;
                      return (
                        <div
                          aria-label={label}
                          className={`schedule-segment schedule-segment--span-${segment.length}`}
                          data-schedule-lane={segment.lane + 1}
                          draggable={!disabled}
                          key={`${segment.taskId}-${segment.startDate}`}
                          onClick={() =>
                            onEditTask?.({
                              taskId: segment.taskId,
                              startDate: segment.startDate,
                              endDate: segment.endDate,
                            })
                          }
                          onDragStart={(event) =>
                            writeDragPayload(event, {
                              taskId: segment.taskId,
                              memberId: member.id,
                              startDate: segment.startDate,
                              endDate: segment.endDate,
                              operation: "move",
                            })
                          }
                          onKeyDown={(event) =>
                            activateTaskEditor(event, () =>
                              onEditTask?.({
                                taskId: segment.taskId,
                                startDate: segment.startDate,
                                endDate: segment.endDate,
                              }),
                            )
                          }
                          role="button"
                          style={{
                            gridColumn: `${segment.startIndex + 1} / span ${segment.length}`,
                            gridRow: segment.lane + 1,
                          }}
                          tabIndex={0}
                          title={label}
                        >
                          <span
                            aria-label={`调整 ${task?.name ?? "未知任务"} 开始日期`}
                            className="schedule-segment__resize schedule-segment__resize--start"
                            draggable={!disabled}
                            onClick={(event) => event.stopPropagation()}
                            onDragStart={(event) => {
                              event.stopPropagation();
                              writeDragPayload(event, {
                                taskId: segment.taskId,
                                memberId: member.id,
                                startDate: segment.startDate,
                                endDate: segment.endDate,
                                operation: "start",
                              });
                            }}
                            role="button"
                            title="拖拽调整开始日期"
                          />
                          <span className="schedule-segment__labels">
                            <small>{project?.name ?? "未知项目"}</small>
                            <span>{task?.name ?? "未知任务"}</span>
                          </span>
                          <b>{formatHours(segment.hours)}</b>
                          <span
                            aria-label={`调整 ${task?.name ?? "未知任务"} 结束日期`}
                            className="schedule-segment__resize schedule-segment__resize--end"
                            draggable={!disabled}
                            onClick={(event) => event.stopPropagation()}
                            onDragStart={(event) => {
                              event.stopPropagation();
                              writeDragPayload(event, {
                                taskId: segment.taskId,
                                memberId: member.id,
                                startDate: segment.startDate,
                                endDate: segment.endDate,
                                operation: "end",
                              });
                            }}
                            role="button"
                            title="拖拽调整结束日期"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

interface DraggedTaskWindow extends TaskWindowChange {
  memberId: string;
  operation: "move" | "start" | "end";
}

const dragDataType = "application/x-teambuddy-task-window";

const writeDragPayload = (
  event: DragEvent<HTMLElement>,
  payload: DraggedTaskWindow,
): void => {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(dragDataType, JSON.stringify(payload));
};

const readDragPayload = (
  event: DragEvent<HTMLElement>,
): DraggedTaskWindow | undefined => {
  try {
    const value = JSON.parse(
      event.dataTransfer.getData(dragDataType),
    ) as Partial<DraggedTaskWindow>;
    return value.taskId &&
      value.memberId &&
      value.startDate &&
      value.endDate &&
      (value.operation === "move" ||
        value.operation === "start" ||
        value.operation === "end")
      ? (value as DraggedTaskWindow)
      : undefined;
  } catch {
    return undefined;
  }
};

const activateTaskEditor = (
  event: KeyboardEvent<HTMLDivElement>,
  activate: () => void,
): void => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
};

export const moveTaskWindow = (
  window: TaskWindowChange,
  nextStartDate: string,
): TaskWindowChange => {
  const offset = calendarDayDifference(window.startDate, nextStartDate);
  return {
    taskId: window.taskId,
    startDate: nextStartDate,
    endDate: addCalendarDays(window.endDate, offset),
  };
};

export const resizeTaskWindow = (
  window: TaskWindowChange,
  edge: "start" | "end",
  date: string,
): TaskWindowChange | undefined => {
  if (edge === "start") {
    return date <= window.endDate ? { ...window, startDate: date } : undefined;
  }
  return date >= window.startDate ? { ...window, endDate: date } : undefined;
};

const applyDraggedTaskWindow = (
  window: DraggedTaskWindow,
  date: string,
):
  | { window: TaskWindowChange; operation: TaskWindowDragOperation }
  | undefined => {
  if (window.operation === "move") {
    return { window: moveTaskWindow(window, date), operation: "move" };
  }
  const resized = resizeTaskWindow(window, window.operation, date);
  return resized ? { window: resized, operation: "resize" } : undefined;
};

const calendarDayDifference = (from: string, to: string): number =>
  Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );

const buildSegments = (
  allocations: ScheduleAllocationDto[],
  days: CalendarDay[],
): Segment[] => {
  const dayIndex = new Map(days.map((day, index) => [day.date, index]));
  const sorted = [...allocations]
    .filter((allocation) => dayIndex.has(allocation.date))
    .sort((left, right) => left.date.localeCompare(right.date));
  const segmentsByTask = new Map<string, Segment>();

  for (const allocation of sorted) {
    const index = dayIndex.get(allocation.date)!;
    const segment = segmentsByTask.get(allocation.taskId);
    if (segment) {
      segment.length = index - segment.startIndex + 1;
      segment.hours += allocation.hours;
      segment.endDate = allocation.date;
      continue;
    }
    segmentsByTask.set(allocation.taskId, {
      taskId: allocation.taskId,
      startIndex: index,
      length: 1,
      hours: allocation.hours,
      startDate: allocation.date,
      endDate: allocation.date,
      lane: 0,
    });
  }
  const segments = [...segmentsByTask.values()].sort(
    (left, right) =>
      left.startIndex - right.startIndex ||
      left.taskId.localeCompare(right.taskId),
  );
  const laneEndIndexes: number[] = [];
  return segments.map((segment) => {
    let lane = laneEndIndexes.findIndex(
      (endIndex) => endIndex < segment.startIndex,
    );
    if (lane === -1) lane = laneEndIndexes.length;
    laneEndIndexes[lane] = segment.startIndex + segment.length - 1;
    return { ...segment, lane };
  });
};

interface CalendarDay {
  date: string;
  weekday: string;
  weekend: boolean;
}

export const buildCalendarDays = (startDate: string): CalendarDay[] =>
  Array.from({ length: 28 }, (_, index) => {
    const date = addCalendarDays(startDate, index);
    const weekdayNumber = dayOfWeek(date);
    return {
      date,
      weekday: ["日", "一", "二", "三", "四", "五", "六"][weekdayNumber]!,
      weekend: weekdayNumber === 0 || weekdayNumber === 6,
    };
  });

const dayOfWeek = (date: string): number => {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const adjustedYear = month < 3 ? year - 1 : year;
  return (
    (adjustedYear +
      Math.floor(adjustedYear / 4) -
      Math.floor(adjustedYear / 100) +
      Math.floor(adjustedYear / 400) +
      offsets[month - 1]! +
      day) %
    7
  );
};

export const addCalendarDays = (date: string, count: number): string => {
  let [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const direction = Math.sign(count);
  for (let remaining = Math.abs(count); remaining > 0; remaining -= 1) {
    day += direction;
    if (direction > 0 && day > daysInMonth(year, month)) {
      day = 1;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    if (direction < 0 && day < 1) {
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      day = daysInMonth(year, month);
    }
  }
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
};

const daysInMonth = (year: number, month: number): number => {
  if (month === 2)
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const formatHours = (hours: number): string =>
  `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
