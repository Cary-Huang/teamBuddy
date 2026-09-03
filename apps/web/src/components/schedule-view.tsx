"use client";

import type {
  MemberDto,
  ProjectDto,
  ScheduleVersionWithAllocationsDto,
  TaskDto,
} from "@teambuddy/contracts";
import type { FormEvent } from "react";
import { useState } from "react";

import {
  ApiClientError,
  apiClient,
  createCorrelationId,
} from "../lib/api/client.js";
import {
  addCalendarDays,
  ScheduleGrid,
  type TaskWindowDragOperation,
  type TaskWindowChange,
} from "./schedule-grid.js";

export function ScheduleView({
  teamId,
  members,
  projects,
  tasks,
  initialSchedule,
}: {
  teamId: string;
  members: MemberDto[];
  projects: ProjectDto[];
  tasks: TaskDto[];
  initialSchedule: ScheduleVersionWithAllocationsDto | null;
}) {
  const [startDate, setStartDate] = useState(currentShanghaiDate());
  const [schedule, setSchedule] = useState(initialSchedule);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [editingWindow, setEditingWindow] = useState<TaskWindowChange>();

  const trigger = async () => {
    const correlationId = createCorrelationId();
    setPending(true);
    setMessage("正在请求重算…");
    try {
      const queued = await apiClient.recalculate(teamId, { correlationId });
      const latest = await waitForDraft({
        eventId: queued.eventId,
        getLatest: () => apiClient.getLatestSchedule(teamId, { correlationId }),
      });
      setSchedule(latest);
      setMessage("草案已生成");
    } catch (error) {
      if (error instanceof RecalculationWaitError) {
        setMessage("等待草案生成超时，请稍后刷新。");
      } else if (isAbortError(error)) {
        setMessage("等待草案生成已取消。");
      } else {
        setMessage("重算请求未完成，请检查 API 与 Worker 服务。");
      }
    } finally {
      setPending(false);
    }
  };

  const applyTaskWindow = async (
    window: TaskWindowChange,
    adjustTaskHours = false,
  ) => {
    const correlationId = createCorrelationId();
    setPending(true);
    setMessage("正在保存人工排期…");
    try {
      const queued = await apiClient.setTaskScheduleWindow(
        teamId,
        window.taskId,
        {
          startDate: window.startDate,
          endDate: window.endDate,
          ...(adjustTaskHours ? { adjustTaskHours: true } : {}),
        },
        { correlationId },
      );
      const latest = await waitForDraft({
        eventId: queued.eventId,
        getLatest: () => apiClient.getLatestSchedule(teamId, { correlationId }),
      });
      setSchedule(latest);
      setStartDate(window.startDate);
      setEditingWindow(window);
      setMessage(
        adjustTaskHours
          ? "排期与预估工时已同步，并生成新草案"
          : "人工排期已保存并生成新草案",
      );
    } catch (error) {
      setMessage(taskWindowErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const submitTaskWindow = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingWindow) return;
    const data = new FormData(event.currentTarget);
    const nextWindow = {
      taskId: editingWindow.taskId,
      startDate: String(data.get("startDate")),
      endDate: String(data.get("endDate")),
    };
    void applyTaskWindow(
      nextWindow,
      calendarSpan(nextWindow) !== calendarSpan(editingWindow),
    );
  };

  const openTaskWindowEditor = (taskId = tasks[0]?.id) => {
    if (!taskId) return;
    setEditingWindow(resolveTaskWindow(taskId, schedule, startDate));
  };

  const editingTask = tasks.find(({ id }) => id === editingWindow?.taskId);

  return (
    <section className="schedule-page">
      <div className="page-heading">
        <div>
          <h1>团队排期</h1>
          <p>固定展示从所选日期开始的连续 28 个上海日历日。</p>
        </div>
        <div className="schedule-controls">
          <button
            onClick={() => setStartDate(addCalendarDays(startDate, -28))}
            type="button"
          >
            上一四周
          </button>
          <button
            onClick={() => setStartDate(currentShanghaiDate())}
            type="button"
          >
            今天
          </button>
          <button
            onClick={() => setStartDate(addCalendarDays(startDate, 28))}
            type="button"
          >
            下一四周
          </button>
        </div>
      </div>
      <div className="toolbar">
        <label>
          排期开始日期
          <input
            aria-label="排期开始日期"
            onChange={(event) => setStartDate(event.target.value)}
            type="date"
            value={startDate}
          />
        </label>
        <button disabled={pending} onClick={trigger} type="button">
          {pending ? "重算中…" : "触发重算"}
        </button>
        <p
          className={
            schedule
              ? "schedule-status schedule-status--ready"
              : "schedule-status"
          }
          role="status"
        >
          {message ?? (schedule ? "草案已生成" : "尚无草案")}
        </p>
      </div>
      <div className="schedule-help">
        <div>
          <strong>调整方式</strong>
          <span>
            拖动任务条可整体平移；拖动左右手柄可调整日期并同步预估工时；点击任务条可精确输入日期。
          </span>
        </div>
        <button
          className="button-secondary"
          disabled={pending || tasks.length === 0}
          onClick={() => openTaskWindowEditor()}
          type="button"
        >
          手动设置排期
        </button>
      </div>
      {editingWindow && editingTask ? (
        <form className="schedule-window-editor" onSubmit={submitTaskWindow}>
          <label className="schedule-window-editor__task">
            任务
            <select
              aria-label="选择排期任务"
              onChange={(event) => openTaskWindowEditor(event.target.value)}
              value={editingTask.id}
            >
              {tasks.map((task) => {
                const project = projects.find(
                  ({ id }) => id === task.projectId,
                );
                return (
                  <option key={task.id} value={task.id}>
                    {project?.name ?? "未知项目"} · {task.name}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            开始日期
            <input
              defaultValue={editingWindow.startDate}
              key={`${editingWindow.taskId}-${editingWindow.startDate}-start`}
              name="startDate"
              required
              type="date"
            />
          </label>
          <label>
            结束日期
            <input
              defaultValue={editingWindow.endDate}
              key={`${editingWindow.taskId}-${editingWindow.endDate}-end`}
              name="endDate"
              required
              type="date"
            />
          </label>
          <button disabled={pending} type="submit">
            保存人工排期
          </button>
          <button
            className="button-secondary"
            disabled={pending}
            onClick={() => setEditingWindow(undefined)}
            type="button"
          >
            关闭
          </button>
        </form>
      ) : null}
      <ScheduleGrid
        allocations={schedule?.allocations ?? []}
        disabled={pending}
        members={members}
        onEditTask={setEditingWindow}
        onMoveTask={(window, operation: TaskWindowDragOperation) =>
          void applyTaskWindow(window, operation === "resize")
        }
        projects={projects}
        startDate={startDate}
        tasks={tasks}
      />
    </section>
  );
}

export class RecalculationWaitError extends Error {
  readonly code = "DRAFT_TIMEOUT";

  constructor() {
    super("等待排期草案生成超时。");
    this.name = "RecalculationWaitError";
  }
}

export const waitForDraft = async ({
  eventId,
  getLatest,
  maxAttempts = 40,
  sleep = defaultSleep,
  signal,
}: {
  eventId: string;
  getLatest: () => Promise<ScheduleVersionWithAllocationsDto | null>;
  maxAttempts?: number;
  sleep?: () => Promise<void>;
  signal?: AbortSignal;
}): Promise<ScheduleVersionWithAllocationsDto> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) throw createAbortError();
    const schedule = await getLatest();
    if (schedule?.sourceEventId === eventId) return schedule;
    if (attempt < maxAttempts - 1) await sleep();
  }
  throw new RecalculationWaitError();
};

const defaultSleep = (): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, 750));

const createAbortError = (): Error => {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const taskWindowErrorMessage = (error: unknown): string => {
  if (error instanceof ApiClientError) {
    if (error.code === "TASK_WINDOW_TOO_SHORT") {
      return "所选日期内可用工时不足，请延长结束日期。";
    }
    if (error.code === "TASK_STATUS_NOT_SCHEDULABLE") {
      return "已阻塞、已完成或已取消的任务不能排期。";
    }
    if (error.code === "TASK_WINDOW_BEFORE_COMPLETED_WORK") {
      return "缩短后的工时不能少于该任务已经完成的工时。";
    }
    return `${error.message}（${error.code}）`;
  }
  if (error instanceof RecalculationWaitError) {
    return "排期已保存，但等待新草案超时，请稍后刷新。";
  }
  return "人工排期保存失败，请检查 API 与 Worker 服务。";
};

const resolveTaskWindow = (
  taskId: string,
  schedule: ScheduleVersionWithAllocationsDto | null,
  fallbackDate: string,
): TaskWindowChange => {
  const dates = (schedule?.allocations ?? [])
    .filter((allocation) => allocation.taskId === taskId)
    .map(({ date }) => date)
    .sort();
  return {
    taskId,
    startDate: dates[0] ?? fallbackDate,
    endDate: dates.at(-1) ?? fallbackDate,
  };
};

const calendarSpan = ({ startDate, endDate }: TaskWindowChange): number =>
  Math.round(
    (Date.parse(`${endDate}T00:00:00.000Z`) -
      Date.parse(`${startDate}T00:00:00.000Z`)) /
      86_400_000,
  );

const currentShanghaiDate = (): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};
