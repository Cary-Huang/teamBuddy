import type {
  ScheduleResultDto,
  ScheduleVersionDto,
  ScheduleVersionWithAllocationsDto,
} from "@teambuddy/contracts";
import { asc, desc, eq } from "drizzle-orm";

import type {
  DatabaseClient,
  DbTransaction,
} from "../../platform/database/client.js";
import { scheduleAllocations, scheduleVersions } from "./planning.schema.js";
import { scheduleResultFingerprint } from "./schedule-result-fingerprint.js";

export interface PlanningRepository {
  findBySourceEventId(eventId: string): Promise<ScheduleVersionDto | null>;
  createDraft(
    tx: DbTransaction,
    sourceEventId: string,
    result: ScheduleResultDto,
  ): Promise<ScheduleVersionDto>;
  getLatest(teamId: string): Promise<ScheduleVersionWithAllocationsDto | null>;
}

export const PLANNING_REPOSITORY = Symbol("PLANNING_REPOSITORY");

type ScheduleVersionRow = typeof scheduleVersions.$inferSelect;

const toScheduleVersionDto = (row: ScheduleVersionRow): ScheduleVersionDto => ({
  id: row.id,
  teamId: row.teamId,
  sourceEventId: row.sourceEventId,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
});

export class DrizzlePlanningRepository implements PlanningRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findBySourceEventId(
    eventId: string,
  ): Promise<ScheduleVersionDto | null> {
    const [row] = await this.database
      .select()
      .from(scheduleVersions)
      .where(eq(scheduleVersions.sourceEventId, eventId))
      .limit(1);
    return row ? toScheduleVersionDto(row) : null;
  }

  async createDraft(
    tx: DbTransaction,
    sourceEventId: string,
    result: ScheduleResultDto,
  ): Promise<ScheduleVersionDto> {
    const resultFingerprint = scheduleResultFingerprint(result);
    const [created] = await tx
      .insert(scheduleVersions)
      .values({
        teamId: result.teamId,
        sourceEventId,
        resultFingerprint,
      })
      .onConflictDoNothing({ target: scheduleVersions.sourceEventId })
      .returning();

    if (!created) {
      const [existing] = await tx
        .select()
        .from(scheduleVersions)
        .where(eq(scheduleVersions.sourceEventId, sourceEventId))
        .limit(1);
      if (!existing)
        throw new Error("Failed to resolve idempotent schedule draft");

      if (
        existing.teamId !== result.teamId ||
        existing.resultFingerprint !== resultFingerprint
      ) {
        throw new ScheduleSourceEventConflictError(sourceEventId);
      }
      return toScheduleVersionDto(existing);
    }

    if (result.allocations.length > 0) {
      await tx.insert(scheduleAllocations).values(
        result.allocations.map((allocation) => ({
          scheduleVersionId: created.id,
          taskId: allocation.taskId,
          memberId: allocation.memberId,
          date: allocation.date,
          hours: allocation.hours,
          source: allocation.source,
        })),
      );
    }

    return toScheduleVersionDto(created);
  }

  async getLatest(
    teamId: string,
  ): Promise<ScheduleVersionWithAllocationsDto | null> {
    const [version] = await this.database
      .select()
      .from(scheduleVersions)
      .where(eq(scheduleVersions.teamId, teamId))
      .orderBy(desc(scheduleVersions.createdAt), desc(scheduleVersions.id))
      .limit(1);
    if (!version) return null;

    const allocations = await this.database
      .select()
      .from(scheduleAllocations)
      .where(eq(scheduleAllocations.scheduleVersionId, version.id))
      .orderBy(
        asc(scheduleAllocations.date),
        asc(scheduleAllocations.memberId),
        asc(scheduleAllocations.taskId),
      );

    return {
      ...toScheduleVersionDto(version),
      allocations: allocations.map((allocation) => ({
        scheduleVersionId: allocation.scheduleVersionId,
        taskId: allocation.taskId,
        memberId: allocation.memberId,
        date: allocation.date,
        hours: allocation.hours,
        source: allocation.source,
      })),
    };
  }
}

export class ScheduleSourceEventConflictError extends Error {
  readonly name = "ScheduleSourceEventConflictError";

  constructor(readonly sourceEventId: string) {
    super(
      `Schedule source event ${sourceEventId} has conflicting persisted data`,
    );
  }
}
