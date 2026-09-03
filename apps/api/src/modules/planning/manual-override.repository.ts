import { and, asc, eq } from "drizzle-orm";

import type {
  DatabaseClient,
  DbTransaction,
} from "../../platform/database/client.js";
import { taskAllocationOverrides } from "./planning.schema.js";

export interface ManualOverrideRecord {
  teamId: string;
  taskId: string;
  memberId: string;
  date: string;
  hours: number;
  locked: true;
}

export const MANUAL_OVERRIDE_REPOSITORY = Symbol("MANUAL_OVERRIDE_REPOSITORY");

export interface ManualOverrideRepository {
  readForTeam(teamId: string): Promise<ManualOverrideRecord[]>;
  replaceForTask(
    tx: DbTransaction,
    teamId: string,
    taskId: string,
    overrides: ManualOverrideRecord[],
  ): Promise<void>;
}

export class DrizzleManualOverrideRepository {
  constructor(private readonly database: DatabaseClient) {}

  async readForTeam(teamId: string): Promise<ManualOverrideRecord[]> {
    const rows = await this.database
      .select()
      .from(taskAllocationOverrides)
      .where(eq(taskAllocationOverrides.teamId, teamId))
      .orderBy(
        asc(taskAllocationOverrides.date),
        asc(taskAllocationOverrides.memberId),
        asc(taskAllocationOverrides.taskId),
      );
    return rows.map((row) => ({
      teamId: row.teamId,
      taskId: row.taskId,
      memberId: row.memberId,
      date: row.date,
      hours: row.hours,
      locked: true,
    }));
  }

  async upsert(
    tx: DbTransaction,
    input: ManualOverrideRecord,
  ): Promise<ManualOverrideRecord> {
    const [row] = await tx
      .insert(taskAllocationOverrides)
      .values(input)
      .onConflictDoUpdate({
        target: [
          taskAllocationOverrides.teamId,
          taskAllocationOverrides.taskId,
          taskAllocationOverrides.memberId,
          taskAllocationOverrides.date,
        ],
        set: { hours: input.hours, locked: true, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("Failed to upsert manual allocation override");
    return {
      teamId: row.teamId,
      taskId: row.taskId,
      memberId: row.memberId,
      date: row.date,
      hours: row.hours,
      locked: true,
    };
  }

  async replaceForTask(
    tx: DbTransaction,
    teamId: string,
    taskId: string,
    overrides: ManualOverrideRecord[],
  ): Promise<void> {
    await tx
      .delete(taskAllocationOverrides)
      .where(
        and(
          eq(taskAllocationOverrides.teamId, teamId),
          eq(taskAllocationOverrides.taskId, taskId),
        ),
      );
    if (overrides.length > 0) {
      await tx.insert(taskAllocationOverrides).values(overrides);
    }
  }
}
