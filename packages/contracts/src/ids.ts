import { z } from 'zod';

const uuidSchema = z.string().uuid();

export const teamIdSchema = uuidSchema.brand<'TeamId'>();
export const memberIdSchema = uuidSchema.brand<'MemberId'>();
export const projectIdSchema = uuidSchema.brand<'ProjectId'>();
export const milestoneIdSchema = uuidSchema.brand<'MilestoneId'>();
export const taskIdSchema = uuidSchema.brand<'TaskId'>();
export const scheduleVersionIdSchema = uuidSchema.brand<'ScheduleVersionId'>();

export type TeamId = z.infer<typeof teamIdSchema>;
export type MemberId = z.infer<typeof memberIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export type MilestoneId = z.infer<typeof milestoneIdSchema>;
export type TaskId = z.infer<typeof taskIdSchema>;
export type ScheduleVersionId = z.infer<typeof scheduleVersionIdSchema>;
