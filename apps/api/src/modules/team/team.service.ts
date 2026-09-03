import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type {
  CapacityExceptionDto,
  CreateMemberRequestDto,
  CreateTeamDto,
  MemberDto,
  TeamDto,
  UpdateMemberDto,
  UpsertCapacityExceptionRequestDto,
} from "@teambuddy/contracts";

import type { DatabaseTransaction } from "../../platform/database/transaction.js";
import {
  DATABASE_TRANSACTION,
  OUTBOX_REPOSITORY,
} from "../../platform/database/database.module.js";
import {
  domainConflict,
  notFound,
} from "../../platform/http/application-error.js";
import {
  appendPlanningRecalculation,
  type MutationContext,
} from "../../platform/outbox/planning-recalculation.js";
import type { OutboxRepository } from "../../platform/outbox/outbox.repository.js";
import { TEAM_REPOSITORY, type TeamRepository } from "./team.repository.js";

@Injectable()
export class TeamService {
  constructor(
    @Inject(DATABASE_TRANSACTION)
    private readonly transaction: DatabaseTransaction,
    @Inject(TEAM_REPOSITORY)
    private readonly teamRepository: TeamRepository,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepository,
  ) {}

  createTeam(input: CreateTeamDto): Promise<TeamDto> {
    return this.transaction.run((tx) =>
      this.teamRepository.createTeam(tx, input),
    );
  }

  async listMembers(teamId: string): Promise<MemberDto[]> {
    await this.requireTeam(teamId);
    return this.teamRepository.listMembers(teamId);
  }

  async createMember(
    teamId: string,
    input: CreateMemberRequestDto,
    context: MutationContext,
  ): Promise<MemberDto> {
    const team = await this.requireTeam(teamId);
    return this.transaction.run(async (tx) => {
      const member = await this.teamRepository.createMember(tx, {
        teamId,
        ...input,
        defaultDailyHours: input.defaultDailyHours ?? team.defaultDailyHours,
      });
      await appendPlanningRecalculation(
        tx,
        this.outboxRepository,
        teamId,
        member.id,
        context,
      );
      return member;
    });
  }

  async updateMember(
    teamId: string,
    memberId: string,
    input: UpdateMemberDto,
    context: MutationContext,
  ): Promise<MemberDto> {
    await this.requireTeam(teamId);

    return this.transaction.run(async (tx) => {
      const member = await this.teamRepository.getMemberForUpdate(tx, memberId);
      if (!member) {
        throw notFound("MEMBER_NOT_FOUND", `Member ${memberId} was not found`);
      }
      if (member.teamId !== teamId) {
        throw domainConflict(
          "MEMBER_NOT_IN_TEAM",
          `Member ${memberId} does not belong to team ${teamId}`,
        );
      }
      const updated = await this.teamRepository.updateMember(
        tx,
        memberId,
        input,
      );
      if (
        member.defaultDailyHours !== updated.defaultDailyHours ||
        member.status !== updated.status
      ) {
        await appendPlanningRecalculation(
          tx,
          this.outboxRepository,
          teamId,
          memberId,
          context,
        );
      }
      return updated;
    });
  }

  async upsertCapacityException(
    memberId: string,
    date: string,
    input: UpsertCapacityExceptionRequestDto,
    context: MutationContext,
  ): Promise<CapacityExceptionDto> {
    await this.requireMember(memberId);
    return this.transaction.run(async (tx) => {
      const member = await this.teamRepository.getMemberForUpdate(tx, memberId);
      if (!member) {
        throw notFound("MEMBER_NOT_FOUND", `Member ${memberId} was not found`);
      }
      const current = await this.teamRepository.getCapacityExceptionForUpdate(
        tx,
        memberId,
        date,
      );
      const result = await this.teamRepository.upsertCapacityException(tx, {
        id: randomUUID(),
        memberId,
        date,
        ...input,
        createdAt: new Date().toISOString(),
      });
      if (
        !current ||
        current.availableHours !== result.availableHours ||
        current.reason !== result.reason
      ) {
        await appendPlanningRecalculation(
          tx,
          this.outboxRepository,
          member.teamId,
          memberId,
          context,
        );
      }
      return result;
    });
  }

  private async requireTeam(teamId: string): Promise<TeamDto> {
    const team = await this.teamRepository.getTeam(teamId);
    if (!team) throw notFound("TEAM_NOT_FOUND", `Team ${teamId} was not found`);
    return team;
  }

  private async requireMember(memberId: string): Promise<MemberDto> {
    const member = await this.teamRepository.getMember(memberId);
    if (!member) {
      throw notFound("MEMBER_NOT_FOUND", `Member ${memberId} was not found`);
    }
    return member;
  }
}
