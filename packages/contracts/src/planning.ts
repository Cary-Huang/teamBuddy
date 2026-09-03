import { z } from "zod";

import {
  scheduleAllocationInputSchema,
  scheduleAllocationSchema,
} from "./work.js";
import { dateKeySchema } from "./team.js";

const uuidSchema = z.string().uuid();

export const scheduleVersionSchema = z
  .object({
    id: z.string().uuid(),
    teamId: z.string().uuid(),
    sourceEventId: z.string().uuid(),
    status: z.literal("DRAFT"),
    createdAt: z.string().datetime(),
  })
  .strict();

export const queuedRecalculationSchema = z
  .object({
    eventId: uuidSchema,
    status: z.literal("queued"),
  })
  .strict();

export const taskScheduleWindowRequestSchema = z
  .object({
    startDate: dateKeySchema,
    endDate: dateKeySchema,
    adjustTaskHours: z.boolean().optional(),
  })
  .strict()
  .refine(({ startDate, endDate }) => startDate <= endDate, {
    message: "Start date must not be after end date",
    path: ["endDate"],
  });

export type ScheduleVersionDto = z.infer<typeof scheduleVersionSchema>;

const scheduleResultFields = {
  allocations: z.array(scheduleAllocationInputSchema),
  taskDates: z.record(
    z.string(),
    z.object({ start: z.string(), end: z.string() }).strict().optional(),
  ),
  warnings: z.array(
    z
      .object({
        code: z.enum(["TASK_BLOCKED", "TASK_OUTSIDE_HORIZON"]),
        taskId: z.string(),
      })
      .strict(),
  ),
};

export const scheduleComputationResultSchema = z
  .object(scheduleResultFields)
  .strict();
export const scheduleResultSchema = z
  .object({ teamId: uuidSchema, ...scheduleResultFields })
  .strict();

export type ScheduleComputationResultDto = z.infer<
  typeof scheduleComputationResultSchema
>;
export type ScheduleResultDto = z.infer<typeof scheduleResultSchema>;

export const scheduleVersionWithAllocationsSchema = scheduleVersionSchema
  .extend({ allocations: z.array(scheduleAllocationSchema) })
  .strict();
export const latestScheduleSchema =
  scheduleVersionWithAllocationsSchema.nullable();

export type QueuedRecalculationDto = z.infer<typeof queuedRecalculationSchema>;
export type TaskScheduleWindowRequestDto = z.infer<
  typeof taskScheduleWindowRequestSchema
>;
export type ScheduleVersionWithAllocationsDto = z.infer<
  typeof scheduleVersionWithAllocationsSchema
>;
