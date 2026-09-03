import { z } from "zod";

const uuidSchema = z.string().uuid();
export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isGregorianDate, { message: "Invalid calendar date" });
export const dailyHoursSchema = z.number().min(0).max(24);
export const memberStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export const createTeamSchema = z
  .object({
    name: z.string().min(1),
    timezone: z.literal("Asia/Shanghai"),
    defaultDailyHours: dailyHoursSchema.default(8),
  })
  .strict();

export const updateTeamSchema = createTeamSchema
  .partial()
  .strict()
  .refine(hasPatchField, { message: "At least one field is required" });

export const teamSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    timezone: z.literal("Asia/Shanghai"),
    defaultDailyHours: dailyHoursSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export const createMemberSchema = z
  .object({
    teamId: uuidSchema,
    name: z.string().min(1),
    status: memberStatusSchema.default("ACTIVE"),
    defaultDailyHours: dailyHoursSchema.optional(),
  })
  .strict();

export const createMemberRequestSchema = createMemberSchema
  .omit({ teamId: true })
  .strict();

export const updateMemberSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: memberStatusSchema.optional(),
    defaultDailyHours: dailyHoursSchema.optional(),
  })
  .strict()
  .refine(hasPatchField, { message: "At least one field is required" });

export const memberSchema = z
  .object({
    id: uuidSchema,
    teamId: uuidSchema,
    name: z.string(),
    status: memberStatusSchema,
    defaultDailyHours: dailyHoursSchema.optional(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const memberListSchema = z.array(memberSchema);

export const upsertCapacityExceptionSchema = z
  .object({
    memberId: uuidSchema,
    date: dateKeySchema,
    availableHours: dailyHoursSchema,
    reason: z.string().min(1).optional(),
  })
  .strict();

export const upsertCapacityExceptionRequestSchema =
  upsertCapacityExceptionSchema.omit({ memberId: true, date: true }).strict();

export const capacityExceptionSchema = z
  .object({
    id: uuidSchema,
    memberId: uuidSchema,
    date: dateKeySchema,
    availableHours: dailyHoursSchema,
    reason: z.string().optional(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const capacityExceptionListSchema = z.array(capacityExceptionSchema);

function hasPatchField(value: object): boolean {
  return Object.keys(value).length > 0;
}

function isGregorianDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysByMonth[month - 1]!;
}

export type CreateTeamDto = z.infer<typeof createTeamSchema>;
export type UpdateTeamDto = z.infer<typeof updateTeamSchema>;
export type TeamDto = z.infer<typeof teamSchema>;
export type CreateMemberDto = z.infer<typeof createMemberSchema>;
export type CreateMemberRequestDto = z.infer<typeof createMemberRequestSchema>;
export type UpdateMemberDto = z.infer<typeof updateMemberSchema>;
export type MemberDto = z.infer<typeof memberSchema>;
export type UpsertCapacityExceptionDto = z.infer<
  typeof upsertCapacityExceptionSchema
>;
export type UpsertCapacityExceptionRequestDto = z.infer<
  typeof upsertCapacityExceptionRequestSchema
>;
export type CapacityExceptionDto = z.infer<typeof capacityExceptionSchema>;

export interface CapacitySnapshotDto {
  team: TeamDto;
  members: MemberDto[];
  exceptions: CapacityExceptionDto[];
}
