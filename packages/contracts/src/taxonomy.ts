import { z } from "zod";

const uuidSchema = z.string().uuid();
export const tagGroupIdSchema = uuidSchema;
export const tagIdSchema = uuidSchema;
const codeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "Code must use lowercase snake_case");

export const tagSelectionModeSchema = z.enum(["SINGLE", "MULTIPLE"]);
export const tagScopeSchema = z.enum(["PROJECT", "TASK", "BOTH"]);
export const tagStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

export const tagGroupSchema = z
  .object({
    id: uuidSchema,
    teamId: uuidSchema,
    code: codeSchema,
    name: z.string().min(1),
    selectionMode: tagSelectionModeSchema,
    scope: tagScopeSchema,
    requiredOnProject: z.boolean(),
    status: tagStatusSchema,
    displayOrder: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const tagSchema = z
  .object({
    id: uuidSchema,
    teamId: uuidSchema,
    groupId: uuidSchema,
    code: codeSchema,
    name: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    description: z.string().optional(),
    status: tagStatusSchema,
    displayOrder: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const taxonomySchema = z
  .object({ groups: z.array(tagGroupSchema), tags: z.array(tagSchema) })
  .strict();

export const createTagGroupRequestSchema = tagGroupSchema
  .pick({
    code: true,
    name: true,
    selectionMode: true,
    scope: true,
    requiredOnProject: true,
    displayOrder: true,
  })
  .partial({ requiredOnProject: true, displayOrder: true })
  .strict();

export const updateTagGroupRequestSchema = tagGroupSchema
  .pick({
    name: true,
    selectionMode: true,
    scope: true,
    requiredOnProject: true,
    status: true,
    displayOrder: true,
  })
  .partial()
  .strict()
  .refine(hasPatchField, { message: "At least one field is required" });

export const createTagRequestSchema = tagSchema
  .pick({
    groupId: true,
    code: true,
    name: true,
    color: true,
    description: true,
    displayOrder: true,
  })
  .partial({ color: true, description: true, displayOrder: true })
  .strict();

export const updateTagRequestSchema = tagSchema
  .pick({
    name: true,
    color: true,
    description: true,
    status: true,
    displayOrder: true,
  })
  .partial()
  .strict()
  .refine(hasPatchField, { message: "At least one field is required" });

export const replaceProjectTagsRequestSchema = z
  .object({ tagIds: z.array(uuidSchema) })
  .strict();

export const projectTagsSchema = z
  .object({ projectId: uuidSchema, tags: z.array(tagSchema) })
  .strict();

export type TagSelectionMode = z.infer<typeof tagSelectionModeSchema>;
export type TagScope = z.infer<typeof tagScopeSchema>;
export type TagStatus = z.infer<typeof tagStatusSchema>;
export type TagGroupDto = z.infer<typeof tagGroupSchema>;
export type TagDto = z.infer<typeof tagSchema>;
export type TaxonomyDto = z.infer<typeof taxonomySchema>;
export type CreateTagGroupRequestDto = z.infer<
  typeof createTagGroupRequestSchema
>;
export type UpdateTagGroupRequestDto = z.infer<
  typeof updateTagGroupRequestSchema
>;
export type CreateTagRequestDto = z.infer<typeof createTagRequestSchema>;
export type UpdateTagRequestDto = z.infer<typeof updateTagRequestSchema>;
export type ReplaceProjectTagsRequestDto = z.infer<
  typeof replaceProjectTagsRequestSchema
>;
export type ProjectTagsDto = z.infer<typeof projectTagsSchema>;

function hasPatchField(value: object): boolean {
  return Object.keys(value).length > 0;
}
