import { z } from "zod";

import { dateKeySchema } from "./team.js";
import { tagSchema } from "./taxonomy.js";
import { taskSchema } from "./work.js";

const uuidSchema = z.string().uuid();
export const projectPrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export const projectStatusSchema = z.enum([
  "PLANNING",
  "IN_PROGRESS",
  "PAUSED",
  "COMPLETED",
  "CANCELED",
]);
export const projectHealthSchema = z.enum(["HEALTHY", "AT_RISK", "CRITICAL"]);

export const createProjectSchema = z
  .object({
    teamId: uuidSchema,
    name: z.string().min(1),
    priority: projectPrioritySchema,
    targetDate: dateKeySchema,
    ownerMemberId: uuidSchema.optional(),
    tagIds: z.array(uuidSchema).default([]),
    status: projectStatusSchema.default("PLANNING"),
    health: projectHealthSchema.default("HEALTHY"),
    healthReason: z.string().min(1).optional(),
  })
  .strict();

export const createProjectRequestSchema = createProjectSchema
  .omit({ teamId: true })
  .strict();

export const updateProjectSchema = z
  .object({
    name: z.string().min(1).optional(),
    priority: projectPrioritySchema.optional(),
    targetDate: dateKeySchema.optional(),
    ownerMemberId: uuidSchema.optional(),
    status: projectStatusSchema.optional(),
    health: projectHealthSchema.optional(),
    healthReason: z.string().min(1).optional(),
  })
  .strict()
  .refine(hasPatchField, { message: "At least one field is required" });

export const projectSchema = z
  .object({
    id: uuidSchema,
    teamId: uuidSchema,
    name: z.string(),
    priority: projectPrioritySchema,
    targetDate: dateKeySchema,
    ownerMemberId: uuidSchema.optional(),
    status: projectStatusSchema,
    health: projectHealthSchema,
    healthReason: z.string().optional(),
    tags: z.array(tagSchema).optional(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const projectListSchema = z.array(projectSchema);

export const createMilestoneSchema = z
  .object({
    projectId: uuidSchema,
    name: z.string().min(1),
    targetDate: dateKeySchema,
    manualRank: z.number().int().nonnegative().default(0),
  })
  .strict();

export const createMilestoneRequestSchema = createMilestoneSchema
  .omit({ projectId: true })
  .strict();

export const updateMilestoneSchema = z
  .object({
    name: z.string().min(1).optional(),
    targetDate: dateKeySchema.optional(),
    manualRank: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(hasPatchField, { message: "At least one field is required" });

export const milestoneSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    name: z.string(),
    targetDate: dateKeySchema,
    manualRank: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const milestoneListSchema = z.array(milestoneSchema);

export const projectDetailSchema = z
  .object({
    project: projectSchema,
    milestones: z.array(milestoneSchema),
    tasks: z.array(taskSchema),
  })
  .strict();

export type ProjectPriority = z.infer<typeof projectPrioritySchema>;
export type CreateProjectDto = z.infer<typeof createProjectSchema>;
export type CreateProjectRequestDto = z.infer<
  typeof createProjectRequestSchema
>;
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
export type ProjectDto = z.infer<typeof projectSchema>;
export type CreateMilestoneDto = z.infer<typeof createMilestoneSchema>;
export type CreateMilestoneRequestDto = z.infer<
  typeof createMilestoneRequestSchema
>;
export type UpdateMilestoneDto = z.infer<typeof updateMilestoneSchema>;
export type MilestoneDto = z.infer<typeof milestoneSchema>;
export type ProjectDetailDto = z.infer<typeof projectDetailSchema>;

function hasPatchField(value: object): boolean {
  return Object.keys(value).length > 0;
}

export interface PortfolioSnapshotDto {
  projects: ProjectDto[];
  milestones: MilestoneDto[];
}
