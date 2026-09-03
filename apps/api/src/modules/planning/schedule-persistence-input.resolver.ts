import {
  scheduleResultSchema,
  type ScheduleComputationResultDto,
  type ScheduleResultDto,
} from "@teambuddy/contracts";

import type { TeamRepository } from "../team/team.repository.js";
import type { WorkRepository } from "../work/work.repository.js";

export type ScheduleScopeResolutionCode =
  "TEAM_NOT_FOUND" | "TASK_NOT_IN_TEAM" | "MEMBER_NOT_IN_TEAM";

export class ScheduleScopeResolutionError extends Error {
  readonly name = "ScheduleScopeResolutionError";

  constructor(
    readonly code: ScheduleScopeResolutionCode,
    readonly referenceId: string,
  ) {
    super(`${code}: ${referenceId}`);
  }
}

export interface SchedulePersistenceInputPort {
  resolve(
    teamId: string,
    computation: ScheduleComputationResultDto,
  ): Promise<ScheduleResultDto>;
}

export class SchedulePersistenceInputResolver implements SchedulePersistenceInputPort {
  constructor(
    private readonly teamRepository: Pick<
      TeamRepository,
      "getTeam" | "listMembers"
    >,
    private readonly workRepository: Pick<WorkRepository, "readWorkSnapshot">,
  ) {}

  async resolve(
    teamId: string,
    computation: ScheduleComputationResultDto,
  ): Promise<ScheduleResultDto> {
    const team = await this.teamRepository.getTeam(teamId);
    if (!team) throw new ScheduleScopeResolutionError("TEAM_NOT_FOUND", teamId);

    const [members, work] = await Promise.all([
      this.teamRepository.listMembers(teamId),
      this.workRepository.readWorkSnapshot(teamId),
    ]);
    const memberIds = new Set(members.map(({ id }) => id));
    const taskIds = new Set(work.tasks.map(({ id }) => id));
    const referencedTaskIds = new Set([
      ...computation.allocations.map(({ taskId }) => taskId),
      ...Object.keys(computation.taskDates),
      ...computation.warnings.map(({ taskId }) => taskId),
    ]);
    for (const taskId of [...referencedTaskIds].sort()) {
      if (!taskIds.has(taskId)) {
        throw new ScheduleScopeResolutionError("TASK_NOT_IN_TEAM", taskId);
      }
    }
    for (const allocation of computation.allocations) {
      if (!memberIds.has(allocation.memberId)) {
        throw new ScheduleScopeResolutionError(
          "MEMBER_NOT_IN_TEAM",
          allocation.memberId,
        );
      }
    }

    return scheduleResultSchema.parse({ teamId, ...computation });
  }
}
