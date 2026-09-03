import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateTaskDependencyRequestDto,
  CreateTaskRequestDto,
  ProjectDetailDto,
  ProjectDto,
  TaskDependencyDto,
  TaskDto,
  UpdateTaskDto,
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
  PORTFOLIO_REPOSITORY,
  type PortfolioRepository,
} from "../portfolio/portfolio.repository.js";
import {
  TEAM_REPOSITORY,
  type TeamRepository,
} from "../team/team.repository.js";
import {
  CreateTaskCommand,
  TaskReferenceValidationError,
} from "./create-task.command.js";
import { WORK_REPOSITORY, type WorkRepository } from "./work.repository.js";

@Injectable()
export class WorkService {
  constructor(
    @Inject(DATABASE_TRANSACTION)
    private readonly transaction: DatabaseTransaction,
    @Inject(TEAM_REPOSITORY)
    private readonly teamRepository: TeamRepository,
    @Inject(PORTFOLIO_REPOSITORY)
    private readonly portfolioRepository: PortfolioRepository,
    @Inject(WORK_REPOSITORY)
    private readonly workRepository: WorkRepository,
    private readonly createTaskCommand: CreateTaskCommand,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async getProjectDetail(projectId: string): Promise<ProjectDetailDto> {
    const project = await this.requireProject(projectId);
    const [milestones, tasks] = await Promise.all([
      this.portfolioRepository.listMilestones(projectId),
      this.workRepository.listTasks(projectId),
    ]);
    return { project, milestones, tasks };
  }

  async listTasks(projectId: string): Promise<TaskDto[]> {
    await this.requireProject(projectId);
    return this.workRepository.listTasks(projectId);
  }

  async createTask(
    projectId: string,
    input: CreateTaskRequestDto,
    context: MutationContext,
  ): Promise<TaskDto> {
    await this.requireProject(projectId);
    await this.validateTaskReferences(projectId, input);

    try {
      return await this.createTaskCommand.execute(
        { projectId, ...input },
        {
          eventId: randomUUID(),
          correlationId: context.correlationId,
          requestedAt: new Date().toISOString(),
        },
      );
    } catch (error) {
      if (error instanceof TaskReferenceValidationError) {
        if (error.code === "PROJECT_NOT_FOUND") {
          throw notFound(
            "PROJECT_NOT_FOUND",
            `Project ${projectId} was not found`,
          );
        }
        throw domainConflict(
          "MEMBER_NOT_IN_TEAM",
          `Task assignee must belong to project ${projectId}'s team`,
        );
      }
      throw error;
    }
  }

  async updateTask(
    projectId: string,
    taskId: string,
    input: UpdateTaskDto,
    context: MutationContext,
  ): Promise<TaskDto> {
    const project = await this.requireProject(projectId);
    const task = await this.requireTask(taskId);
    if (task.projectId !== projectId) {
      throw domainConflict(
        "TASK_NOT_IN_PROJECT",
        `Task ${taskId} does not belong to project ${projectId}`,
      );
    }
    await this.validateTaskReferences(projectId, input);

    return this.transaction.run(async (tx) => {
      const current = await this.workRepository.getTaskForUpdate(tx, taskId);
      if (!current) {
        throw notFound("TASK_NOT_FOUND", `Task ${taskId} was not found`);
      }
      if (current.projectId !== projectId) {
        throw domainConflict(
          "TASK_NOT_IN_PROJECT",
          `Task ${taskId} does not belong to project ${projectId}`,
        );
      }
      const updated = await this.workRepository.updateTask(tx, taskId, input);
      if (taskSchedulingInputChanged(current, updated)) {
        await appendPlanningRecalculation(
          tx,
          this.outboxRepository,
          project.teamId,
          taskId,
          context,
        );
      }
      return updated;
    });
  }

  async addDependency(
    successorTaskId: string,
    input: CreateTaskDependencyRequestDto,
    context: MutationContext,
  ): Promise<TaskDependencyDto> {
    const [predecessor, successor] = await Promise.all([
      this.requireTask(input.predecessorTaskId),
      this.requireTask(successorTaskId),
    ]);
    if (predecessor.projectId !== successor.projectId) {
      throw domainConflict(
        "TASK_NOT_IN_PROJECT",
        "Task dependencies must stay within one project",
      );
    }
    const project = await this.requireProject(successor.projectId);
    const dependency = {
      predecessorTaskId: predecessor.id,
      successorTaskId: successor.id,
    };
    await this.transaction.run(async (tx) => {
      await this.workRepository.lockProjectDependencies(tx, project.id);
      const dependencies = await this.workRepository.readProjectDependencies(
        tx,
        project.id,
      );
      if (createsDependencyCycle(dependencies, dependency)) {
        throw domainConflict(
          "DEPENDENCY_CYCLE",
          "Task dependency would create a cycle",
          dependency,
        );
      }

      const inserted = await this.workRepository.addDependency(tx, dependency);
      if (!inserted) return;
      await appendPlanningRecalculation(
        tx,
        this.outboxRepository,
        project.teamId,
        successorTaskId,
        context,
      );
    });
    return dependency;
  }

  private async requireProject(projectId: string): Promise<ProjectDto> {
    const project = await this.portfolioRepository.getProject(projectId);
    if (!project) {
      throw notFound("PROJECT_NOT_FOUND", `Project ${projectId} was not found`);
    }
    return project;
  }

  private async requireTask(taskId: string): Promise<TaskDto> {
    const task = await this.workRepository.getTask(taskId);
    if (!task) throw notFound("TASK_NOT_FOUND", `Task ${taskId} was not found`);
    return task;
  }

  private async validateTaskReferences(
    projectId: string,
    input:
      | Pick<
          CreateTaskRequestDto,
          "assigneeId" | "milestoneId" | "parentTaskId"
        >
      | UpdateTaskDto,
  ): Promise<void> {
    const project = await this.requireProject(projectId);
    if (input.assigneeId) {
      const member = await this.teamRepository.getMember(input.assigneeId);
      if (!member || member.teamId !== project.teamId) {
        throw domainConflict(
          "MEMBER_NOT_IN_TEAM",
          `Member ${input.assigneeId} does not belong to team ${project.teamId}`,
        );
      }
    }
    if (input.milestoneId) {
      const milestone = await this.portfolioRepository.getMilestone(
        input.milestoneId,
      );
      if (!milestone || milestone.projectId !== projectId) {
        throw domainConflict(
          "MILESTONE_NOT_IN_PROJECT",
          `Milestone ${input.milestoneId} does not belong to project ${projectId}`,
        );
      }
    }
    if (input.parentTaskId) {
      const parent = await this.workRepository.getTask(input.parentTaskId);
      if (!parent || parent.projectId !== projectId) {
        throw domainConflict(
          "PARENT_TASK_NOT_IN_PROJECT",
          `Parent task ${input.parentTaskId} does not belong to project ${projectId}`,
        );
      }
    }
  }
}

const createsDependencyCycle = (
  dependencies: readonly TaskDependencyDto[],
  candidate: TaskDependencyDto,
): boolean => {
  if (candidate.predecessorTaskId === candidate.successorTaskId) return true;

  const successors = new Map<string, string[]>();
  for (const dependency of [...dependencies, candidate]) {
    const entries = successors.get(dependency.predecessorTaskId) ?? [];
    entries.push(dependency.successorTaskId);
    successors.set(dependency.predecessorTaskId, entries);
  }

  const pending = [candidate.successorTaskId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === candidate.predecessorTaskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(successors.get(current) ?? []));
  }
  return false;
};

const taskSchedulingInputChanged = (before: TaskDto, after: TaskDto): boolean =>
  before.milestoneId !== after.milestoneId ||
  before.assigneeId !== after.assigneeId ||
  before.remainingHours !== after.remainingHours ||
  before.status !== after.status ||
  before.manualRank !== after.manualRank;
