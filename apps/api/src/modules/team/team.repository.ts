import type {
  CapacityExceptionDto,
  CapacitySnapshotDto,
  CreateMemberDto,
  CreateTeamDto,
  MemberDto,
  TeamDto,
  UpdateMemberDto,
} from "@teambuddy/contracts";
import { and, asc, eq, inArray } from "drizzle-orm";

import type {
  DatabaseClient,
  DbTransaction,
} from "../../platform/database/client.js";
import { capacityExceptions, members, teams } from "./team.schema.js";

export const TEAM_REPOSITORY = Symbol("TEAM_REPOSITORY");

export interface TeamRepository {
  createTeam(tx: DbTransaction, input: CreateTeamDto): Promise<TeamDto>;
  getTeam(teamId: string): Promise<TeamDto | null>;
  createMember(tx: DbTransaction, input: CreateMemberDto): Promise<MemberDto>;
  getMember(memberId: string): Promise<MemberDto | null>;
  getMemberForUpdate(
    tx: DbTransaction,
    memberId: string,
  ): Promise<MemberDto | null>;
  listMembers(teamId: string): Promise<MemberDto[]>;
  updateMember(
    tx: DbTransaction,
    memberId: string,
    input: UpdateMemberDto,
  ): Promise<MemberDto>;
  upsertCapacityException(
    tx: DbTransaction,
    input: CapacityExceptionDto,
  ): Promise<CapacityExceptionDto>;
  getCapacityExceptionForUpdate(
    tx: DbTransaction,
    memberId: string,
    date: string,
  ): Promise<CapacityExceptionDto | null>;
  readCapacitySnapshot(teamId: string): Promise<CapacitySnapshotDto>;
}

type TeamRow = typeof teams.$inferSelect;
type MemberRow = typeof members.$inferSelect;
type CapacityExceptionRow = typeof capacityExceptions.$inferSelect;

const toTeamDto = (row: TeamRow): TeamDto => ({
  id: row.id,
  name: row.name,
  timezone: row.timezone as TeamDto["timezone"],
  defaultDailyHours: row.defaultDailyHours,
  createdAt: row.createdAt.toISOString(),
});

const toMemberDto = (row: MemberRow): MemberDto => ({
  id: row.id,
  teamId: row.teamId,
  name: row.name,
  status: row.status,
  defaultDailyHours: row.defaultDailyHours,
  createdAt: row.createdAt.toISOString(),
});

const toCapacityExceptionDto = (
  row: CapacityExceptionRow,
): CapacityExceptionDto => ({
  id: row.id,
  memberId: row.memberId,
  date: row.date,
  availableHours: row.availableHours,
  reason: row.reason ?? undefined,
  createdAt: row.createdAt.toISOString(),
});

export class DrizzleTeamRepository implements TeamRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createTeam(tx: DbTransaction, input: CreateTeamDto): Promise<TeamDto> {
    const [row] = await tx.insert(teams).values(input).returning();
    if (!row) throw new Error("Failed to create team");
    return toTeamDto(row);
  }

  async getTeam(teamId: string): Promise<TeamDto | null> {
    const [row] = await this.database
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    return row ? toTeamDto(row) : null;
  }

  async createMember(
    tx: DbTransaction,
    input: CreateMemberDto,
  ): Promise<MemberDto> {
    const [row] = await tx.insert(members).values(input).returning();
    if (!row) throw new Error("Failed to create member");
    return toMemberDto(row);
  }

  async getMember(memberId: string): Promise<MemberDto | null> {
    const [row] = await this.database
      .select()
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);
    return row ? toMemberDto(row) : null;
  }

  async getMemberForUpdate(
    tx: DbTransaction,
    memberId: string,
  ): Promise<MemberDto | null> {
    const [row] = await tx
      .select()
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1)
      .for("update");
    return row ? toMemberDto(row) : null;
  }

  async listMembers(teamId: string): Promise<MemberDto[]> {
    const rows = await this.database
      .select()
      .from(members)
      .where(eq(members.teamId, teamId))
      .orderBy(asc(members.createdAt), asc(members.id));
    return rows.map(toMemberDto);
  }

  async updateMember(
    tx: DbTransaction,
    memberId: string,
    input: UpdateMemberDto,
  ): Promise<MemberDto> {
    const [row] = await tx
      .update(members)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(members.id, memberId))
      .returning();
    if (!row) throw new Error(`Member ${memberId} was not found`);
    return toMemberDto(row);
  }

  async upsertCapacityException(
    tx: DbTransaction,
    input: CapacityExceptionDto,
  ): Promise<CapacityExceptionDto> {
    const [row] = await tx
      .insert(capacityExceptions)
      .values({
        id: input.id,
        memberId: input.memberId,
        date: input.date,
        availableHours: input.availableHours,
        reason: input.reason,
        createdAt: new Date(input.createdAt),
      })
      .onConflictDoUpdate({
        target: [capacityExceptions.memberId, capacityExceptions.date],
        set: {
          availableHours: input.availableHours,
          reason: input.reason,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error("Failed to upsert capacity exception");
    return toCapacityExceptionDto(row);
  }

  async getCapacityExceptionForUpdate(
    tx: DbTransaction,
    memberId: string,
    date: string,
  ): Promise<CapacityExceptionDto | null> {
    const [row] = await tx
      .select()
      .from(capacityExceptions)
      .where(
        and(
          eq(capacityExceptions.memberId, memberId),
          eq(capacityExceptions.date, date),
        ),
      )
      .limit(1)
      .for("update");
    return row ? toCapacityExceptionDto(row) : null;
  }

  async readCapacitySnapshot(teamId: string): Promise<CapacitySnapshotDto> {
    const team = await this.getTeam(teamId);
    if (!team) throw new Error(`Team ${teamId} was not found`);

    const memberDtos = await this.listMembers(teamId);
    const exceptionRows =
      memberDtos.length === 0
        ? []
        : await this.database
            .select()
            .from(capacityExceptions)
            .where(
              inArray(
                capacityExceptions.memberId,
                memberDtos.map((member) => member.id),
              ),
            );

    return {
      team,
      members: memberDtos,
      exceptions: exceptionRows.map(toCapacityExceptionDto),
    };
  }
}
