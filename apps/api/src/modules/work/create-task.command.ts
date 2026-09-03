import {
  recalculateScheduleRequestedV1Schema,
  type CreateTaskDto,
  type TaskDto,
} from "@teambuddy/contracts";

import type { DatabaseTransaction } from "../../platform/database/transaction.js";
import type { OutboxRepository } from "../../platform/outbox/outbox.repository.js";
import type { PortfolioRepository } from "../portfolio/portfolio.repository.js";
import type { TeamRepository } from "../team/team.repository.js";
import type { WorkRepository } from "./work.repository.js";

export type TaskReferenceValidationCode =
  "PROJECT_NOT_FOUND" | "MEMBER_NOT_FOUND" | "MEMBER_NOT_IN_TEAM";

export class TaskReferenceValidationError extends Error {
  readonly name = "TaskReferenceValidationError";

  constructor(readonly code: TaskReferenceValidationCode) {
    super(code);
  }
}

export interface CreateTaskCommandContext {
  eventId: string;
  idempotencyKey?: string;
  correlationId: string;
  requestedAt: string;
}

export class CreateTaskCommand {
  constructor(
    private readonly transaction: DatabaseTransaction,
    private readonly teamRepository: Pick<TeamRepository, "getMember">,
    private readonly portfolioRepository: Pick<
      PortfolioRepository,
      "getProject"
    >,
    private readonly workRepository: Pick<WorkRepository, "createTask">,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async execute(
    input: CreateTaskDto,
    context: CreateTaskCommandContext,
  ): Promise<TaskDto> {
    const [project, member] = await Promise.all([
      this.portfolioRepository.getProject(input.projectId),
      this.teamRepository.getMember(input.assigneeId),
    ]);

    if (!project) throw new TaskReferenceValidationError("PROJECT_NOT_FOUND");
    if (!member) throw new TaskReferenceValidationError("MEMBER_NOT_FOUND");
    if (member.teamId !== project.teamId) {
      throw new TaskReferenceValidationError("MEMBER_NOT_IN_TEAM");
    }

    const event = recalculateScheduleRequestedV1Schema.parse({
      type: "planning.recalculate.requested.v1",
      eventId: context.eventId,
      correlationId: context.correlationId,
      teamId: project.teamId,
      requestedAt: context.requestedAt,
    });

    return this.transaction.run(async (tx) => {
      const task = await this.workRepository.createTask(tx, input);
      await this.outboxRepository.append(tx, {
        eventId: event.eventId,
        idempotencyKey: context.idempotencyKey,
        type: event.type,
        correlationId: event.correlationId,
        aggregateId: task.id,
        payload: event,
        occurredAt: event.requestedAt,
      });
      return task;
    });
  }
}
