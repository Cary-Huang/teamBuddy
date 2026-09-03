import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateMilestoneRequestDto,
  CreateProjectRequestDto,
  MilestoneDto,
  ProjectDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
} from "@teambuddy/contracts";

import {
  DATABASE_TRANSACTION,
  OUTBOX_REPOSITORY,
} from "../../platform/database/database.module.js";
import type { DatabaseTransaction } from "../../platform/database/transaction.js";
import {
  domainConflict,
  notFound,
} from "../../platform/http/application-error.js";
import {
  appendPlanningRecalculation,
  type MutationContext,
} from "../../platform/outbox/planning-recalculation.js";
import type { OutboxRepository } from "../../platform/outbox/outbox.repository.js";
import {
  TEAM_REPOSITORY,
  type TeamRepository,
} from "../team/team.repository.js";
import {
  PORTFOLIO_REPOSITORY,
  type PortfolioRepository,
} from "./portfolio.repository.js";
import { TaxonomyService } from "../taxonomy/taxonomy.service.js";

@Injectable()
export class PortfolioService {
  constructor(
    @Inject(DATABASE_TRANSACTION)
    private readonly transaction: DatabaseTransaction,
    @Inject(TEAM_REPOSITORY)
    private readonly teamRepository: TeamRepository,
    @Inject(PORTFOLIO_REPOSITORY)
    private readonly portfolioRepository: PortfolioRepository,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepository,
    private readonly taxonomyService: TaxonomyService,
  ) {}

  async listProjects(teamId: string): Promise<ProjectDto[]> {
    await this.requireTeam(teamId);
    return this.portfolioRepository.listProjects(teamId);
  }

  async createProject(
    teamId: string,
    input: CreateProjectRequestDto,
    context: MutationContext,
  ): Promise<ProjectDto> {
    await this.requireTeam(teamId);
    if (input.ownerMemberId) {
      await this.requireMemberInTeam(input.ownerMemberId, teamId);
    }

    const { tagIds, ...projectInput } = input;
    const selectedTags = await this.taxonomyService.validateProjectTags(
      teamId,
      tagIds,
    );
    return this.transaction.run(async (tx) => {
      const project = await this.portfolioRepository.createProject(tx, {
        teamId,
        ...projectInput,
        tagIds,
      });
      await this.taxonomyService.replaceProjectTagsInTransaction(
        tx,
        teamId,
        project.id,
        tagIds,
      );
      await appendPlanningRecalculation(
        tx,
        this.outboxRepository,
        teamId,
        project.id,
        context,
      );
      return { ...project, tags: selectedTags };
    });
  }

  async updateProject(
    teamId: string,
    projectId: string,
    input: UpdateProjectDto,
    context: MutationContext,
  ): Promise<ProjectDto> {
    await this.requireTeam(teamId);
    const project = await this.requireProject(projectId);
    if (project.teamId !== teamId) {
      throw domainConflict(
        "PROJECT_NOT_IN_TEAM",
        `Project ${projectId} does not belong to team ${teamId}`,
      );
    }
    if (input.ownerMemberId) {
      await this.requireMemberInTeam(input.ownerMemberId, teamId);
    }

    return this.transaction.run(async (tx) => {
      const current = await this.portfolioRepository.getProjectForUpdate(
        tx,
        projectId,
      );
      if (!current) {
        throw notFound(
          "PROJECT_NOT_FOUND",
          `Project ${projectId} was not found`,
        );
      }
      if (current.teamId !== teamId) {
        throw domainConflict(
          "PROJECT_NOT_IN_TEAM",
          `Project ${projectId} does not belong to team ${teamId}`,
        );
      }
      const updated = await this.portfolioRepository.updateProject(
        tx,
        projectId,
        input,
      );
      if (
        current.priority !== updated.priority ||
        current.targetDate !== updated.targetDate ||
        current.status !== updated.status
      ) {
        await appendPlanningRecalculation(
          tx,
          this.outboxRepository,
          teamId,
          projectId,
          context,
        );
      }
      return updated;
    });
  }

  async listMilestones(projectId: string): Promise<MilestoneDto[]> {
    await this.requireProject(projectId);
    return this.portfolioRepository.listMilestones(projectId);
  }

  async createMilestone(
    projectId: string,
    input: CreateMilestoneRequestDto,
    context: MutationContext,
  ): Promise<MilestoneDto> {
    const project = await this.requireProject(projectId);
    return this.transaction.run(async (tx) => {
      const milestone = await this.portfolioRepository.createMilestone(tx, {
        projectId,
        ...input,
      });
      await appendPlanningRecalculation(
        tx,
        this.outboxRepository,
        project.teamId,
        milestone.id,
        context,
      );
      return milestone;
    });
  }

  async updateMilestone(
    projectId: string,
    milestoneId: string,
    input: UpdateMilestoneDto,
    context: MutationContext,
  ): Promise<MilestoneDto> {
    const project = await this.requireProject(projectId);
    const milestone = await this.requireMilestone(milestoneId);
    if (milestone.projectId !== projectId) {
      throw domainConflict(
        "MILESTONE_NOT_IN_PROJECT",
        `Milestone ${milestoneId} does not belong to project ${projectId}`,
      );
    }

    return this.transaction.run(async (tx) => {
      const current = await this.portfolioRepository.getMilestoneForUpdate(
        tx,
        milestoneId,
      );
      if (!current) {
        throw notFound(
          "MILESTONE_NOT_FOUND",
          `Milestone ${milestoneId} was not found`,
        );
      }
      if (current.projectId !== projectId) {
        throw domainConflict(
          "MILESTONE_NOT_IN_PROJECT",
          `Milestone ${milestoneId} does not belong to project ${projectId}`,
        );
      }
      const updated = await this.portfolioRepository.updateMilestone(
        tx,
        milestoneId,
        input,
      );
      if (current.targetDate !== updated.targetDate) {
        await appendPlanningRecalculation(
          tx,
          this.outboxRepository,
          project.teamId,
          milestoneId,
          context,
        );
      }
      return updated;
    });
  }

  private async requireTeam(teamId: string): Promise<void> {
    if (!(await this.teamRepository.getTeam(teamId))) {
      throw notFound("TEAM_NOT_FOUND", `Team ${teamId} was not found`);
    }
  }

  private async requireProject(projectId: string): Promise<ProjectDto> {
    const project = await this.portfolioRepository.getProject(projectId);
    if (!project) {
      throw notFound("PROJECT_NOT_FOUND", `Project ${projectId} was not found`);
    }
    return project;
  }

  private async requireMilestone(milestoneId: string): Promise<MilestoneDto> {
    const milestone = await this.portfolioRepository.getMilestone(milestoneId);
    if (!milestone) {
      throw notFound(
        "MILESTONE_NOT_FOUND",
        `Milestone ${milestoneId} was not found`,
      );
    }
    return milestone;
  }

  private async requireMemberInTeam(
    memberId: string,
    teamId: string,
  ): Promise<void> {
    const member = await this.teamRepository.getMember(memberId);
    if (!member || member.teamId !== teamId) {
      throw domainConflict(
        "MEMBER_NOT_IN_TEAM",
        `Member ${memberId} does not belong to team ${teamId}`,
      );
    }
  }
}
