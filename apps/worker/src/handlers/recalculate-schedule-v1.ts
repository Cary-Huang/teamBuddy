import type { BackendApplicationPorts } from "@teambuddy/api/backend";
import {
  dateKeySchema,
  recalculateScheduleRequestedV1Schema,
  type RecalculateScheduleRequestedV1,
  type ScheduleVersionDto,
} from "@teambuddy/contracts";
import {
  buildCapacityCalendar,
  schedule,
  type DateKey,
  type ScheduleInput,
  type ScheduleResult,
} from "@teambuddy/scheduler";

type ScheduleFunction = (input: ScheduleInput) => ScheduleResult;

export class RecalculateScheduleV1Handler {
  constructor(
    private readonly ports: BackendApplicationPorts,
    private readonly runSchedule: ScheduleFunction = schedule,
  ) {}

  async handle(payload: unknown): Promise<ScheduleVersionDto> {
    const event = recalculateScheduleRequestedV1Schema.parse(payload);
    const existing = await this.ports.planning.findBySourceEventId(
      event.eventId,
    );
    if (existing) {
      if (existing.teamId !== event.teamId) {
        throw new PlanningInputError(
          "SOURCE_EVENT_TEAM_MISMATCH",
          event.eventId,
        );
      }
      return existing;
    }

    const team = await this.ports.team.getTeam(event.teamId);
    if (!team) {
      throw new PlanningInputError("TEAM_NOT_FOUND", event.teamId);
    }

    const [capacity, portfolio, work, manualOverrides] = await Promise.all([
      this.ports.team.readCapacitySnapshot(event.teamId),
      this.ports.portfolio.readPortfolioSnapshot(event.teamId),
      this.ports.work.readWorkSnapshot(event.teamId),
      this.ports.manualOverrides.read(event.teamId),
    ]);
    const input = normalizeScheduleInput(
      event,
      capacity,
      portfolio,
      work,
      manualOverrides.map(({ teamId: _teamId, ...override }) => ({
        ...override,
        date: dateKeySchema.parse(override.date) as DateKey,
      })),
    );
    const computation = this.runSchedule(input);

    // Scope resolution intentionally happens before Planning opens its transaction.
    const resolved = await this.ports.schedulePersistence.resolve(
      event.teamId,
      computation,
    );
    return this.ports.planning.createDraft(event.eventId, resolved);
  }
}

type CapacitySnapshot = Awaited<
  ReturnType<BackendApplicationPorts["team"]["readCapacitySnapshot"]>
>;
type PortfolioSnapshot = Awaited<
  ReturnType<BackendApplicationPorts["portfolio"]["readPortfolioSnapshot"]>
>;
type WorkSnapshot = Awaited<
  ReturnType<BackendApplicationPorts["work"]["readWorkSnapshot"]>
>;

export const normalizeScheduleInput = (
  event: RecalculateScheduleRequestedV1,
  capacity: CapacitySnapshot,
  portfolio: PortfolioSnapshot,
  work: WorkSnapshot,
  manualOverrides: ScheduleInput["manualOverrides"] = [],
): ScheduleInput => {
  if (capacity.team.id !== event.teamId) {
    throw new PlanningInputError("CAPACITY_TEAM_MISMATCH", capacity.team.id);
  }

  const startDate = shanghaiDateKey(event.requestedAt);
  const allMemberIds = new Set(capacity.members.map(({ id }) => id));
  const activeMemberIds = new Set(
    capacity.members
      .filter(({ status }) => status === "ACTIVE")
      .map(({ id }) => id),
  );
  const allProjectIds = new Set(portfolio.projects.map(({ id }) => id));
  const activeProjects = portfolio.projects.filter(
    ({ status }) => status === "PLANNING" || status === "IN_PROGRESS",
  );
  const activeProjectIds = new Set(activeProjects.map(({ id }) => id));
  const activeMilestones = portfolio.milestones.filter(
    ({ projectId }) =>
      !allProjectIds.has(projectId) || activeProjectIds.has(projectId),
  );
  const allTaskIds = new Set(work.tasks.map(({ id }) => id));
  const activeTasks = work.tasks.filter(
    ({ projectId, assigneeId }) =>
      (!allProjectIds.has(projectId) || activeProjectIds.has(projectId)) &&
      (!allMemberIds.has(assigneeId) || activeMemberIds.has(assigneeId)),
  );
  const activeTaskIds = new Set(activeTasks.map(({ id }) => id));
  const activeTasksById = new Map(activeTasks.map((task) => [task.id, task]));
  const endDate = [
    startDate,
    ...(event.horizonEndDate ? [event.horizonEndDate as DateKey] : []),
    ...activeProjects.map(({ targetDate }) => targetDate as DateKey),
    ...activeMilestones.map(({ targetDate }) => targetDate as DateKey),
  ].reduce((latest, candidate) => (candidate > latest ? candidate : latest));
  for (const task of [...work.tasks].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (!allMemberIds.has(task.assigneeId)) {
      throw new PlanningInputError("MISSING_ASSIGNEE", task.assigneeId);
    }
  }

  const input: ScheduleInput = {
    startDate,
    endDate,
    capacity: {
      timezone: capacity.team.timezone,
      defaultDailyHours: capacity.team.defaultDailyHours,
      memberDailyHours: Object.fromEntries(
        capacity.members.map((member) => [
          member.id,
          member.status === "ACTIVE" ? member.defaultDailyHours : 0,
        ]),
      ),
      exceptions: capacity.exceptions.map((exception) => ({
        memberId: exception.memberId,
        date: exception.date as DateKey,
        availableHours: exception.availableHours,
      })),
    },
    projects: activeProjects.map((project) => ({
      id: project.id,
      priority: project.priority,
      targetDate: project.targetDate as DateKey,
    })),
    milestones: activeMilestones.map((milestone) => ({
      id: milestone.id,
      projectId: milestone.projectId,
      targetDate: milestone.targetDate as DateKey,
    })),
    tasks: activeTasks.map((task) => ({
      id: task.id,
      projectId: task.projectId,
      ...(task.milestoneId ? { milestoneId: task.milestoneId } : {}),
      assigneeId: task.assigneeId,
      remainingHours: task.remainingHours,
      status: task.status,
      manualRank: task.manualRank,
    })),
    dependencies: work.dependencies.filter(
      ({ predecessorTaskId, successorTaskId }) =>
        !allTaskIds.has(predecessorTaskId) ||
        !allTaskIds.has(successorTaskId) ||
        (activeTaskIds.has(predecessorTaskId) &&
          activeTaskIds.has(successorTaskId)),
    ),
    manualOverrides: manualOverrides.filter(({ taskId, memberId }) => {
      if (!allTaskIds.has(taskId)) return true;
      const task = activeTasksById.get(taskId);
      return task?.assigneeId === memberId && activeMemberIds.has(memberId);
    }),
  };

  const calendar = buildCapacityCalendar(input.capacity);
  for (const task of input.tasks) {
    if (
      task.remainingHours > 0 &&
      !["BLOCKED", "COMPLETED", "CANCELED"].includes(task.status)
    ) {
      calendar.nextWorkingDate(task.assigneeId, startDate);
    }
  }
  return input;
};

const shanghaiDateKey = (timestamp: string): DateKey => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const valueByType = new Map(parts.map(({ type, value }) => [type, value]));
  return dateKeySchema.parse(
    `${valueByType.get("year")}-${valueByType.get("month")}-${valueByType.get("day")}`,
  ) as DateKey;
};

export type PlanningInputCode =
  | "TEAM_NOT_FOUND"
  | "CAPACITY_TEAM_MISMATCH"
  | "MISSING_ASSIGNEE"
  | "SOURCE_EVENT_TEAM_MISMATCH";

export class PlanningInputError extends Error {
  readonly name = "PlanningInputError";

  constructor(
    readonly code: PlanningInputCode,
    readonly referenceId: string,
  ) {
    super(`${code}: ${referenceId}`);
  }
}
