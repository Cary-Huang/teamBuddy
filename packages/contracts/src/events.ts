import { z } from "zod";

import { dateKeySchema } from "./team.js";

export const recalculateScheduleRequestedV1Schema = z
  .object({
    type: z.literal("planning.recalculate.requested.v1"),
    eventId: z.string().uuid(),
    correlationId: z.string().uuid(),
    teamId: z.string().uuid(),
    requestedAt: z.string().datetime(),
    horizonEndDate: dateKeySchema.optional(),
  })
  .strict();

export type RecalculateScheduleRequestedV1 = z.infer<
  typeof recalculateScheduleRequestedV1Schema
>;
