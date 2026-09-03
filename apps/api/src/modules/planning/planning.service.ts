import { Inject, Injectable } from "@nestjs/common";
import type {
  CapacitySnapshotDto,
  ScheduleVersionWithAllocationsDto,
  TaskDto,
  TaskScheduleWindowRequestDto,
} from "@teambuddy/contracts";

import {
  DATABASE_TRANSACTION,
  OUTBOX_REPOSITORY,
} from "../../platform/database/database.module.js";
import type { DatabaseTransaction } from "../../platform/database/transaction.js";
import {
  domainConflict,
  notFound,
} from "../../platform/http/application-error.js";
import {
  appendPlanningRecalculation,
  type MutationContext,
} from "../../platform/outbox/planning-recalculation.js";
import type { OutboxRepository } from "../../platform/outbox/outbox.repository.js";
import {
  TEAM_REPOSITORY,
  type TeamRepository,
} from "../team/team.repository.js";
import {
  WORK_REPOSITORY,
  type WorkRepository,
} from "../work/work.repository.js";
import {
  MANUAL_OVERRIDE_REPOSITORY,
  type ManualOverrideRecord,
  type ManualOverrideRepository,
} from "./manual-override.repository.js";
import {
  PLANNING_REPOSITORY,
  type PlanningRepository,
} from "./planning.repository.js";

export interface QueuedRecalculationDto {
  eventId: string;
  status: "queued";
}

@Injectable()
export class PlanningService {
  constructor(
    @Inject(DATABASE_TRANSACTION)
    private readonly transaction: DatabaseTransaction,
    @Inject(TEAM_REPOSITORY)
    private readonly teamRepository: TeamRepository,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepository,
    @Inject(PLANNING_REPOSITORY)
    private readonly planningRepository: PlanningRepository,
    @Inject(WORK_REPOSITORY)
    private readonly workRepository: WorkRepository,
    @Inject(MANUAL_OVERRIDE_REPOSITORY)
    private readonly manualOverrideRepository: ManualOverrideRepository,
  ) {}

  async queueRecalculation(
    teamId: string,
    context: MutationContext,
  ): Promise<QueuedRecalculationDto> {
    await this.requireTeam(teamId);
    return this.transaction.run(async (tx) => {
      const event = await appendPlanningRecalculation(
        tx,
        this.outboxRepository,
        teamId,
        teamId,
        context,
      );
      return { eventId: event.eventId, status: "queued" };
    });
  }

  async getLatest(
    teamId: string,
  ): Promise<ScheduleVersionWithAllocationsDto | null> {
    await this.requireTeam(teamId);
    return this.planningRepository.getLatest(teamId);
  }

  async setTaskWindow(
    teamId: string,
    taskId: string,
    input: TaskScheduleWindowRequestDto,
    context: MutationContext,
  ): Promise<QueuedRecalculationDto> {
    await this.requireTeam(teamId);
    const [capacity, work] = await Promise.all([
      this.teamRepository.readCapacitySnapshot(teamId),
      this.workRepository.readWorkSnapshot(teamId),
    ]);
    const task = work.tasks.find(({ id }) => id === taskId);
    if (!task) {
      throw notFound(
        "TASK_NOT_IN_TEAM",
        `Task ${taskId} was not found in team ${teamId}`,
      );
    }
    const adjustedEffort = input.adjustTaskHours
      ? calculateAdjustedTaskEffort(task, capacity, input)
      : undefined;
    const scheduledTask = adjustedEffort
      ? { ...task, ...adjustedEffort }
      : task;
    const datedOverrides = buildTaskWindowOverrides(
      scheduledTask,
      capacity,
      input,
    );
    const overrides: ManualOverrideRecord[] = datedOverrides.map(
      ({ date, hours }) => ({
        teamId,
        taskId,
        memberId: task.assigneeId,
        date,
        hours,
        locked: true,
      }),
    );

    return this.transaction.run(async (tx) => {
      if (adjustedEffort) {
        await this.workRepository.updateTask(tx, taskId, adjustedEffort);
      }
      await this.manualOverrideRepository.replaceForTask(
        tx,
        teamId,
        taskId,
        overrides,
      );
      const event = await appendPlanningRecalculation(
        tx,
        this.outboxRepository,
        teamId,
        taskId,
        context,
        { horizonEndDate: input.endDate },
      );
      return { eventId: event.eventId, status: "queued" };
    });
  }

  private async requireTeam(teamId: string): Promise<void> {
    if (!(await this.teamRepository.getTeam(teamId))) {
      throw notFound("TEAM_NOT_FOUND", `Team ${teamId} was not found`);
    }
  }
}

interface DatedOverride {
  date: string;
  hours: number;
}

export const buildTaskWindowOverrides = (
  task: TaskDto,
  capacity: CapacitySnapshotDto,
  input: TaskScheduleWindowRequestDto,
): DatedOverride[] => {
  if (["BLOCKED", "COMPLETED", "CANCELED"].includes(task.status)) {
    throw domainConflict(
      "TASK_STATUS_NOT_SCHEDULABLE",
      `Task status ${task.status} cannot be manually scheduled`,
      { status: task.status },
    );
  }
  if (task.remainingHours <= 0) {
    throw domainConflict(
      "TASK_HAS_NO_REMAINING_WORK",
      "Task has no remaining work to schedule",
    );
  }

  const days = taskWindowCapacityDays(task, capacity, input);
  const availableHours = days.reduce((total, day) => total + day.capacity, 0);
  if (days.length === 0) {
    throw domainConflict(
      "TASK_WINDOW_HAS_NO_CAPACITY",
      "Selected dates contain no available working time",
    );
  }
  if (availableHours + Number.EPSILON < task.remainingHours) {
    throw domainConflict(
      "TASK_WINDOW_TOO_SHORT",
      "Selected dates do not have enough capacity for the task's remaining work",
      { requiredHours: task.remainingHours, availableHours },
    );
  }
  let remainingHours = task.remainingHours;
  return days.map((day, index) => {
    const hours =
      index === days.length - 1
        ? remainingHours
        : roundHours((task.remainingHours * day.capacity) / availableHours);
    remainingHours = roundHours(remainingHours - hours);
    return { date: day.date, hours };
  });
};

export const calculateAdjustedTaskEffort = (
  task: TaskDto,
  capacity: CapacitySnapshotDto,
  input: TaskScheduleWindowRequestDto,
): Pick<TaskDto, "estimatedHours" | "remainingHours"> => {
  const estimatedHours = roundHours(
    taskWindowCapacityDays(task, capacity, input).reduce(
      (total, day) => total + day.capacity,
      0,
    ),
  );
  const completedHours = roundHours(
    Math.max(0, task.estimatedHours - task.remainingHours),
  );
  if (estimatedHours + Number.EPSILON < completedHours) {
    throw domainConflict(
      "TASK_WINDOW_BEFORE_COMPLETED_WORK",
      "Selected dates contain less capacity than the task's completed work",
      { completedHours, estimatedHours },
    );
  }
  return {
    estimatedHours,
    remainingHours: roundHours(estimatedHours - completedHours),
  };
};

const taskWindowCapacityDays = (
  task: TaskDto,
  capacity: CapacitySnapshotDto,
  input: TaskScheduleWindowRequestDto,
): Array<{ date: string; capacity: number }> => {
  const member = capacity.members.find(({ id }) => id === task.assigneeId);
  if (!member || member.status !== "ACTIVE") {
    throw domainConflict(
      "TASK_ASSIGNEE_UNAVAILABLE",
      "Task assignee is not an active member of this team",
    );
  }
  const exceptionHours = new Map(
    capacity.exceptions
      .filter(({ memberId }) => memberId === member.id)
      .map(({ date, availableHours }) => [date, availableHours]),
  );
  const days = dateRange(input.startDate, input.endDate)
    .map((date) => ({
      date,
      capacity:
        exceptionHours.get(date) ??
        (isWeekend(date)
          ? 0
          : (member.defaultDailyHours ?? capacity.team.defaultDailyHours)),
    }))
    .filter(({ capacity: availableHours }) => availableHours > 0);
  if (days.length === 0) {
    throw domainConflict(
      "TASK_WINDOW_HAS_NO_CAPACITY",
      "Selected dates contain no available working time",
    );
  }
  return days;
};

const dateRange = (startDate: string, endDate: string): string[] => {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDay(date)) {
    dates.push(date);
  }
  return dates;
};

const addDay = (date: string): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};

const isWeekend = (date: string): boolean => {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
};

const roundHours = (hours: number): number =>
  Math.round(hours * 10_000) / 10_000;
