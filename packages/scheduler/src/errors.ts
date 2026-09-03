export class DependencyCycleError extends Error {
  constructor(readonly taskIds: string[]) {
    super(`Dependency cycle detected: ${taskIds.join(' -> ')}`);
    this.name = 'DependencyCycleError';
  }
}

export type InvalidScheduleInputCode =
  | 'UNKNOWN_PROJECT'
  | 'UNKNOWN_MILESTONE'
  | 'UNKNOWN_DEPENDENCY_TASK'
  | 'UNKNOWN_OVERRIDE_TASK'
  | 'OVERRIDE_ASSIGNEE_MISMATCH'
  | 'INVALID_OVERRIDE_HOURS'
  | 'DUPLICATE_MANUAL_OVERRIDE'
  | 'DUPLICATE_CAPACITY_EXCEPTION'
  | 'MANUAL_HOURS_EXCEED_REMAINING'
  | 'OVERRIDE_INVALID_TASK_STATUS'
  | 'MANUAL_OVERRIDE_BEFORE_EARLIEST_START'
  | 'MANUAL_OVERRIDE_UNSATISFIED';

export class InvalidScheduleInputError extends Error {
  constructor(readonly code: InvalidScheduleInputCode) {
    super(`Invalid schedule input: ${code}`);
    this.name = 'InvalidScheduleInputError';
  }
}
