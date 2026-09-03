import { buildCapacityCalendar, NoWorkingDateError } from "./capacity-calendar";
import { addDays } from "./date-key";
import { validateDependencies } from "./dependency-graph";
import { InvalidScheduleInputError } from "./errors";
import type {
  Allocation,
  DateKey,
  DependencyInput,
  ManualAllocationOverrideInput,
  ProjectScheduleInput,
  ScheduleInput,
  ScheduleResult,
  ScheduleWarning,
  TaskScheduleInput,
} from "./types";

interface SchedulingTask {
  input: TaskScheduleInput;
  projectPriority: ProjectScheduleInput["priority"];
  milestoneTargetDate: DateKey;
  downstreamCount: number;
  remainingHours: number;
}

const PRIORITY_RANK: Record<ProjectScheduleInput["priority"], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

function compareDate(left: DateKey, right: DateKey): number {
  return left.localeCompare(right);
}

function compareReadyTasks(
  left: SchedulingTask,
  right: SchedulingTask,
): number {
  return (
    PRIORITY_RANK[left.projectPriority] -
      PRIORITY_RANK[right.projectPriority] ||
    compareDate(left.milestoneTargetDate, right.milestoneTargetDate) ||
    right.downstreamCount - left.downstreamCount ||
    left.input.manualRank - right.input.manualRank ||
    left.input.id.localeCompare(right.input.id)
  );
}

function buildDependencyMaps(
  tasks: TaskScheduleInput[],
  dependencies: DependencyInput[],
): {
  predecessors: Map<string, Set<string>>;
  successors: Map<string, Set<string>>;
} {
  const taskIds = new Set(tasks.map(({ id }) => id));
  const predecessors = new Map<string, Set<string>>();
  const successors = new Map<string, Set<string>>();
  for (const taskId of taskIds) {
    predecessors.set(taskId, new Set());
    successors.set(taskId, new Set());
  }
  for (const { predecessorTaskId, successorTaskId } of dependencies) {
    if (!taskIds.has(predecessorTaskId) || !taskIds.has(successorTaskId))
      continue;
    predecessors.get(successorTaskId)?.add(predecessorTaskId);
    successors.get(predecessorTaskId)?.add(successorTaskId);
  }
  return { predecessors, successors };
}

function downstreamCount(
  taskId: string,
  successors: Map<string, Set<string>>,
): number {
  const downstream = new Set<string>();
  const pending = [...(successors.get(taskId) ?? [])].sort().reverse();
  while (pending.length > 0) {
    const successorId = pending.pop();
    if (successorId === undefined || downstream.has(successorId)) continue;
    downstream.add(successorId);
    pending.push(...[...(successors.get(successorId) ?? [])].sort().reverse());
  }
  return downstream.size;
}

function capacityKey(memberId: string, date: DateKey): string {
  return `${memberId}\u0000${date}`;
}

function maxDate(left: DateKey | undefined, right: DateKey): DateKey {
  return left === undefined || right > left ? right : left;
}

function allocationComparator(left: Allocation, right: Allocation): number {
  return (
    left.date.localeCompare(right.date) ||
    left.memberId.localeCompare(right.memberId) ||
    left.taskId.localeCompare(right.taskId) ||
    left.source.localeCompare(right.source) ||
    left.hours - right.hours
  );
}

function hasDuplicate(keys: string[]): boolean {
  const sortedKeys = [...keys].sort();
  return sortedKeys.some(
    (key, index) => index > 0 && key === sortedKeys[index - 1],
  );
}

function overrideKey(override: ManualAllocationOverrideInput): string {
  return `${override.taskId}\u0000${override.memberId}\u0000${override.date}`;
}

function validateScheduleInput(input: ScheduleInput): void {
  if (
    hasDuplicate(
      input.capacity.exceptions.map((capacityException) =>
        capacityKey(capacityException.memberId, capacityException.date),
      ),
    )
  ) {
    throw new InvalidScheduleInputError("DUPLICATE_CAPACITY_EXCEPTION");
  }

  const projectIds = new Set(input.projects.map(({ id }) => id));
  const sortedMilestones = [...input.milestones].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const sortedTasks = [...input.tasks].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  for (const milestone of sortedMilestones) {
    if (!projectIds.has(milestone.projectId)) {
      throw new InvalidScheduleInputError("UNKNOWN_PROJECT");
    }
  }
  for (const task of sortedTasks) {
    if (!projectIds.has(task.projectId)) {
      throw new InvalidScheduleInputError("UNKNOWN_PROJECT");
    }
  }

  const milestoneIds = new Set(input.milestones.map(({ id }) => id));
  for (const task of sortedTasks) {
    if (task.milestoneId !== undefined && !milestoneIds.has(task.milestoneId)) {
      throw new InvalidScheduleInputError("UNKNOWN_MILESTONE");
    }
  }

  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  if (
    input.dependencies.some(
      ({ predecessorTaskId, successorTaskId }) =>
        !taskById.has(predecessorTaskId) || !taskById.has(successorTaskId),
    )
  ) {
    throw new InvalidScheduleInputError("UNKNOWN_DEPENDENCY_TASK");
  }

  const sortedOverrides = [...input.manualOverrides].sort((left, right) =>
    overrideKey(left).localeCompare(overrideKey(right)),
  );
  for (const override of sortedOverrides) {
    if (!taskById.has(override.taskId)) {
      throw new InvalidScheduleInputError("UNKNOWN_OVERRIDE_TASK");
    }
  }
  for (const override of sortedOverrides) {
    const task = taskById.get(override.taskId);
    if (task !== undefined && override.memberId !== task.assigneeId) {
      throw new InvalidScheduleInputError("OVERRIDE_ASSIGNEE_MISMATCH");
    }
  }
  if (
    sortedOverrides.some(({ hours }) => !Number.isFinite(hours) || hours <= 0)
  ) {
    throw new InvalidScheduleInputError("INVALID_OVERRIDE_HOURS");
  }
  for (const override of sortedOverrides) {
    const status = taskById.get(override.taskId)?.status;
    if (
      status === "BLOCKED" ||
      status === "COMPLETED" ||
      status === "CANCELED"
    ) {
      throw new InvalidScheduleInputError("OVERRIDE_INVALID_TASK_STATUS");
    }
  }
  if (hasDuplicate(sortedOverrides.map(overrideKey))) {
    throw new InvalidScheduleInputError("DUPLICATE_MANUAL_OVERRIDE");
  }

  const manualHoursByTask = new Map<string, number>();
  for (const override of sortedOverrides) {
    manualHoursByTask.set(
      override.taskId,
      (manualHoursByTask.get(override.taskId) ?? 0) + override.hours,
    );
  }
  for (const [taskId, manualHours] of [...manualHoursByTask].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const remainingHours = taskById.get(taskId)?.remainingHours;
    if (remainingHours !== undefined && manualHours > remainingHours) {
      throw new InvalidScheduleInputError("MANUAL_HOURS_EXCEED_REMAINING");
    }
  }
}

export function schedule(input: ScheduleInput): ScheduleResult {
  validateScheduleInput(input);
  validateDependencies(input.tasks, input.dependencies);

  const calendar = buildCapacityCalendar(input.capacity);
  const projects = new Map(
    input.projects.map((project) => [project.id, project]),
  );
  const milestones = new Map(
    input.milestones.map((milestone) => [milestone.id, milestone]),
  );
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const { predecessors, successors } = buildDependencyMaps(
    input.tasks,
    input.dependencies,
  );
  const schedulingTasks = new Map<string, SchedulingTask>();

  for (const task of [...input.tasks].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const project = projects.get(task.projectId);
    if (project === undefined)
      throw new Error(`Unknown project: ${task.projectId}`);
    const milestoneTargetDate =
      task.milestoneId === undefined
        ? project.targetDate
        : milestones.get(task.milestoneId)!.targetDate;
    schedulingTasks.set(task.id, {
      input: task,
      projectPriority: project.priority,
      milestoneTargetDate,
      downstreamCount: downstreamCount(task.id, successors),
      remainingHours: task.remainingHours,
    });
  }

  const allocations: Allocation[] = [];
  const capacityUsed = new Map<string, number>();
  const lastAllocationDate = new Map<string, DateKey>();
  const completionDates = new Map<string, DateKey>();
  const attempted = new Set<string>();
  const warningKeys = new Set<string>();
  const warnings: ScheduleWarning[] = [];
  const beforeHorizon = addDays(input.startDate, -1);

  function addWarning(code: ScheduleWarning["code"], taskId: string): void {
    const key = `${code}\u0000${taskId}`;
    if (warningKeys.has(key)) return;
    warningKeys.add(key);
    warnings.push({ code, taskId });
  }

  for (const task of schedulingTasks.values()) {
    if (task.input.status === "BLOCKED") {
      addWarning("TASK_BLOCKED", task.input.id);
    } else if (
      task.input.status === "COMPLETED" ||
      task.input.status === "CANCELED" ||
      task.remainingHours <= 0
    ) {
      completionDates.set(task.input.id, beforeHorizon);
    }
  }

  const manualOverrides = [...input.manualOverrides]
    .filter((override) => override.date <= input.endDate)
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.memberId.localeCompare(right.memberId) ||
        left.taskId.localeCompare(right.taskId) ||
        left.hours - right.hours,
    );
  const manualOverridesByTask = new Map<
    string,
    ManualAllocationOverrideInput[]
  >();
  for (const override of manualOverrides) {
    const taskOverrides = manualOverridesByTask.get(override.taskId) ?? [];
    taskOverrides.push(override);
    manualOverridesByTask.set(override.taskId, taskOverrides);
  }

  const memberNextDate = new Map<string, DateKey>();
  const appliedManualTasks = new Set<string>();

  while (true) {
    const readyTasks = [...schedulingTasks.values()]
      .filter(
        (task) =>
          task.remainingHours > 0 &&
          !attempted.has(task.input.id) &&
          task.input.status !== "BLOCKED" &&
          task.input.status !== "COMPLETED" &&
          task.input.status !== "CANCELED" &&
          [...(predecessors.get(task.input.id) ?? [])].every((taskId) =>
            completionDates.has(taskId),
          ),
      )
      .sort(compareReadyTasks);
    const task = readyTasks[0];
    if (task === undefined) break;
    attempted.add(task.input.id);

    const memberId = task.input.assigneeId;
    let earliestStart = input.startDate;
    for (const predecessorId of predecessors.get(task.input.id) ?? []) {
      const predecessorEnd = completionDates.get(predecessorId);
      if (predecessorEnd !== undefined) {
        earliestStart = maxDate(earliestStart, addDays(predecessorEnd, 1));
      }
    }

    const taskOverrides = manualOverridesByTask.get(task.input.id) ?? [];
    if (
      taskOverrides.some(
        (override) =>
          override.date >= input.startDate && override.date < earliestStart,
      )
    ) {
      throw new InvalidScheduleInputError(
        "MANUAL_OVERRIDE_BEFORE_EARLIEST_START",
      );
    }
    if (taskOverrides.length > 0) appliedManualTasks.add(task.input.id);
    for (const override of taskOverrides) {
      allocations.push({
        taskId: override.taskId,
        memberId: override.memberId,
        date: override.date,
        hours: override.hours,
        source: "MANUAL",
      });
      const key = capacityKey(override.memberId, override.date);
      capacityUsed.set(key, (capacityUsed.get(key) ?? 0) + override.hours);
      lastAllocationDate.set(
        override.taskId,
        maxDate(lastAllocationDate.get(override.taskId), override.date),
      );
      task.remainingHours -= override.hours;
    }

    if (task.remainingHours <= 0) {
      completionDates.set(
        task.input.id,
        lastAllocationDate.get(task.input.id) ?? beforeHorizon,
      );
      continue;
    }

    let cursor = maxDate(memberNextDate.get(memberId), earliestStart);
    let lastAutomaticDate: DateKey | undefined;
    while (task.remainingHours > 0 && cursor <= input.endDate) {
      let date: DateKey;
      try {
        date = calendar.nextWorkingDate(memberId, cursor);
      } catch (error) {
        if (error instanceof NoWorkingDateError) break;
        throw error;
      }
      if (date > input.endDate) break;

      const key = capacityKey(memberId, date);
      const availableHours = Math.max(
        0,
        calendar.availableHours(memberId, date) - (capacityUsed.get(key) ?? 0),
      );
      if (availableHours <= 0) {
        cursor = addDays(date, 1);
        continue;
      }

      const hours = Math.min(task.remainingHours, availableHours);
      allocations.push({
        taskId: task.input.id,
        memberId,
        date,
        hours,
        source: "AUTOMATIC",
      });
      capacityUsed.set(key, (capacityUsed.get(key) ?? 0) + hours);
      task.remainingHours -= hours;
      lastAutomaticDate = date;
      lastAllocationDate.set(
        task.input.id,
        maxDate(lastAllocationDate.get(task.input.id), date),
      );
      cursor = addDays(date, 1);
    }

    if (lastAutomaticDate !== undefined) {
      memberNextDate.set(memberId, addDays(lastAutomaticDate, 1));
    }
    if (task.remainingHours <= 0) {
      completionDates.set(
        task.input.id,
        lastAllocationDate.get(task.input.id) ?? beforeHorizon,
      );
    } else {
      addWarning("TASK_OUTSIDE_HORIZON", task.input.id);
    }
  }

  for (const task of schedulingTasks.values()) {
    if (
      task.remainingHours > 0 &&
      task.input.status !== "BLOCKED" &&
      task.input.status !== "COMPLETED" &&
      task.input.status !== "CANCELED"
    ) {
      addWarning("TASK_OUTSIDE_HORIZON", task.input.id);
    }
  }

  const unsatisfiedOverrideTaskId = [...manualOverridesByTask.keys()]
    .sort()
    .find((taskId) => !appliedManualTasks.has(taskId));
  if (unsatisfiedOverrideTaskId !== undefined) {
    throw new InvalidScheduleInputError("MANUAL_OVERRIDE_UNSATISFIED");
  }

  allocations.sort(allocationComparator);
  warnings.sort(
    (left, right) =>
      left.taskId.localeCompare(right.taskId) ||
      left.code.localeCompare(right.code),
  );

  const taskDates: ScheduleResult["taskDates"] = {};
  for (const taskId of [...tasksById.keys()].sort()) {
    const taskAllocations = allocations.filter(
      (allocation) => allocation.taskId === taskId,
    );
    const start = taskAllocations[0]?.date;
    const end = taskAllocations.at(-1)?.date;
    if (start !== undefined && end !== undefined)
      taskDates[taskId] = { start, end };
  }

  return { allocations, taskDates, warnings };
}
