export type DateKey = `${number}-${number}-${number}`;

export interface CapacityExceptionInput {
  memberId: string;
  date: DateKey;
  availableHours: number;
}

export interface CapacityCalendarInput {
  timezone: 'Asia/Shanghai';
  defaultDailyHours: number;
  memberDailyHours: Record<string, number | undefined>;
  exceptions: CapacityExceptionInput[];
}

export interface CapacityCalendar {
  availableHours(memberId: string, date: DateKey): number;
  nextWorkingDate(memberId: string, from: DateKey): DateKey;
}

export type TaskStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'CANCELED';

export interface ProjectScheduleInput {
  id: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  targetDate: DateKey;
}

export interface MilestoneScheduleInput {
  id: string;
  projectId: string;
  targetDate: DateKey;
}

export interface TaskScheduleInput {
  id: string;
  projectId: string;
  milestoneId?: string;
  assigneeId: string;
  remainingHours: number;
  status: TaskStatus;
  manualRank: number;
}

export interface DependencyInput {
  predecessorTaskId: string;
  successorTaskId: string;
}

export interface ManualAllocationOverrideInput {
  taskId: string;
  memberId: string;
  date: DateKey;
  hours: number;
  locked: true;
}

export interface ScheduleInput {
  startDate: DateKey;
  endDate: DateKey;
  capacity: CapacityCalendarInput;
  projects: ProjectScheduleInput[];
  milestones: MilestoneScheduleInput[];
  tasks: TaskScheduleInput[];
  dependencies: DependencyInput[];
  manualOverrides: ManualAllocationOverrideInput[];
}

export interface Allocation {
  taskId: string;
  memberId: string;
  date: DateKey;
  hours: number;
  source: 'AUTOMATIC' | 'MANUAL';
}

export interface ScheduleWarning {
  code: 'TASK_BLOCKED' | 'TASK_OUTSIDE_HORIZON';
  taskId: string;
}

export interface ScheduleResult {
  allocations: Allocation[];
  taskDates: Partial<Record<string, { start: DateKey; end: DateKey }>>;
  warnings: ScheduleWarning[];
}
