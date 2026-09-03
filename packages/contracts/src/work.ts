import { z } from "zod";

import { dateKeySchema } from "./team.js";

const uuidSchema = z.string().uuid();
export const taskStatusSchema = z.enum([
  "NOT_STARTED",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELED",
]);

const workHoursSchema = z.number().nonnegative();

export const createTaskSchema = z
  .object({
    projectId: uuidSchema,
    milestoneId: uuidSchema.optional(),
    parentTaskId: uuidSchema.optional(),
    assigneeId: uuidSchema,
    name: z.string().min(1),
    estimatedHours: workHoursSchema,
    remainingHours: workHoursSchema,
    status: taskStatusSchema.default("NOT_STARTED"),
    manualRank: z.number().int().nonnegative().default(0),
    locked: z.boolean().default(false),
  })
  .strict();

export const createTaskRequestSchema = createTaskSchema
  .omit({ projectId: true })
  .strict();

export const updateTaskSchema = z
  .object({
    milestoneId: uuidSchema.optional(),
    parentTaskId: uuidSchema.optional(),
    assigneeId: uuidSchema.optional(),
    name: z.string().min(1).optional(),
    estimatedHours: workHoursSchema.optional(),
    remainingHours: workHoursSchema.optional(),
    status: taskStatusSchema.optional(),
    manualRank: z.number().int().nonnegative().optional(),
    locked: z.boolean().optional(),
  })
  .strict()
  .refine(hasPatchField, { message: "At least one field is required" });

export const taskSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    milestoneId: uuidSchema.optional(),
    parentTaskId: uuidSchema.optional(),
    assigneeId: uuidSchema,
    name: z.string(),
    estimatedHours: workHoursSchema,
    remainingHours: workHoursSchema,
    status: taskStatusSchema,
    manualRank: z.number().int().nonnegative(),
    locked: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const taskListSchema = z.array(taskSchema);

export const taskDependencySchema = z
  .object({
    predecessorTaskId: uuidSchema,
    successorTaskId: uuidSchema,
  })
  .strict();

export const createTaskDependencyRequestSchema = taskDependencySchema
  .pick({ predecessorTaskId: true })
  .strict();

export const scheduleAllocationSchema = z
  .object({
    scheduleVersionId: uuidSchema,
    taskId: uuidSchema,
    memberId: uuidSchema,
    date: dateKeySchema,
    hours: z.number().positive().max(24),
    source: z.enum(["AUTOMATIC", "MANUAL"]),
  })
  .strict();

export const scheduleAllocationInputSchema = scheduleAllocationSchema
  .omit({ scheduleVersionId: true })
  .strict();

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type CreateTaskDto = z.infer<typeof createTaskSchema>;
export type CreateTaskRequestDto = z.infer<typeof createTaskRequestSchema>;
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;
export type TaskDto = z.infer<typeof taskSchema>;
export type TaskDependencyDto = z.infer<typeof taskDependencySchema>;
export type CreateTaskDependencyRequestDto = z.infer<
  typeof createTaskDependencyRequestSchema
>;
export type ScheduleAllocationInputDto = z.infer<
  typeof scheduleAllocationInputSchema
>;
export type ScheduleAllocationDto = z.infer<typeof scheduleAllocationSchema>;

export interface WorkSnapshotDto {
  tasks: TaskDto[];
  dependencies: TaskDependencyDto[];
}

function hasPatchField(value: object): boolean {
  return Object.keys(value).length > 0;
}
