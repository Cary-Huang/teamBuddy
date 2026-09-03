import type {
  CapacitySnapshotDto,
  PortfolioSnapshotDto,
  ScheduleComputationResultDto,
  ScheduleResultDto,
  ScheduleVersionDto,
  TeamDto,
  WorkSnapshotDto,
} from "@teambuddy/contracts";

import {
  DrizzlePlanningRepository,
  type PlanningRepository,
} from "../modules/planning/planning.repository.js";
import { DrizzleManualOverrideRepository } from "../modules/planning/manual-override.repository.js";
import {
  SchedulePersistenceInputResolver,
  type SchedulePersistenceInputPort,
} from "../modules/planning/schedule-persistence-input.resolver.js";
import { DrizzlePortfolioRepository } from "../modules/portfolio/portfolio.repository.js";
import { DrizzleTeamRepository } from "../modules/team/team.repository.js";
import { PortfolioProjectScopeReader } from "../modules/work/project-scope.adapter.js";
import { DrizzleWorkRepository } from "../modules/work/work.repository.js";
import { createDatabaseClient } from "../platform/database/client.js";
import { migrateDatabase } from "../platform/database/migrate.js";
import { PostgresDatabaseTransaction } from "../platform/database/transaction.js";

export interface TeamPlanningReadPort {
  getTeam(teamId: string): Promise<TeamDto | null>;
  readCapacitySnapshot(teamId: string): Promise<CapacitySnapshotDto>;
}

export interface PortfolioPlanningReadPort {
  readPortfolioSnapshot(teamId: string): Promise<PortfolioSnapshotDto>;
}

export interface WorkPlanningReadPort {
  readWorkSnapshot(teamId: string): Promise<WorkSnapshotDto>;
}

export interface PlanningDraftWritePort {
  createDraft(
    sourceEventId: string,
    result: ScheduleResultDto,
  ): Promise<ScheduleVersionDto>;
}

export interface PlanningReadPort {
  findBySourceEventId(eventId: string): Promise<ScheduleVersionDto | null>;
}

export interface ManualOverrideDto {
  teamId: string;
  taskId: string;
  memberId: string;
  date: string;
  hours: number;
  locked: true;
}

export interface ManualOverridePort {
  read(teamId: string): Promise<ManualOverrideDto[]>;
  upsert(input: ManualOverrideDto): Promise<ManualOverrideDto>;
}

export interface BackendApplicationPorts {
  team: TeamPlanningReadPort;
  portfolio: PortfolioPlanningReadPort;
  work: WorkPlanningReadPort;
  schedulePersistence: SchedulePersistenceInputPort;
  planning: PlanningReadPort & PlanningDraftWritePort;
  manualOverrides: ManualOverridePort;
  close(): Promise<void>;
}

export const createBackendApplicationPorts = (
  databaseUrl: string,
): BackendApplicationPorts => {
  const connection = createDatabaseClient(databaseUrl);
  const transaction = new PostgresDatabaseTransaction(connection.db);
  const teamRepository = new DrizzleTeamRepository(connection.db);
  const portfolioRepository = new DrizzlePortfolioRepository(connection.db);
  const workRepository = new DrizzleWorkRepository(
    connection.db,
    new PortfolioProjectScopeReader(portfolioRepository),
  );
  const planningRepository: PlanningRepository = new DrizzlePlanningRepository(
    connection.db,
  );
  const schedulePersistence = new SchedulePersistenceInputResolver(
    teamRepository,
    workRepository,
  );
  const manualOverrideRepository = new DrizzleManualOverrideRepository(
    connection.db,
  );

  return {
    team: {
      getTeam: (teamId) => teamRepository.getTeam(teamId),
      readCapacitySnapshot: (teamId) =>
        teamRepository.readCapacitySnapshot(teamId),
    },
    portfolio: {
      readPortfolioSnapshot: (teamId) =>
        portfolioRepository.readPortfolioSnapshot(teamId),
    },
    work: {
      readWorkSnapshot: (teamId) => workRepository.readWorkSnapshot(teamId),
    },
    schedulePersistence,
    planning: {
      findBySourceEventId: (eventId) =>
        planningRepository.findBySourceEventId(eventId),
      createDraft: (sourceEventId, result) =>
        transaction.run((tx) =>
          planningRepository.createDraft(tx, sourceEventId, result),
        ),
    },
    manualOverrides: {
      read: async (teamId) =>
        (await manualOverrideRepository.readForTeam(teamId)).map(
          toPublicOverride,
        ),
      upsert: async (input) => {
        const [members, work] = await Promise.all([
          teamRepository.listMembers(input.teamId),
          workRepository.readWorkSnapshot(input.teamId),
        ]);
        const task = work.tasks.find(({ id }) => id === input.taskId);
        if (!task || task.assigneeId !== input.memberId) {
          throw new Error("Manual override task is outside the requested team");
        }
        if (!members.some(({ id }) => id === input.memberId)) {
          throw new Error(
            "Manual override member is outside the requested team",
          );
        }
        return transaction
          .run((tx) => manualOverrideRepository.upsert(tx, input))
          .then(toPublicOverride);
      },
    },
    close: () => connection.close(),
  };
};

const toPublicOverride = (input: {
  teamId: string;
  taskId: string;
  memberId: string;
  date: string;
  hours: number;
  locked: true;
}): ManualOverrideDto => ({ ...input });

export const migrateBackendDatabase = (databaseUrl: string): Promise<void> =>
  migrateDatabase(databaseUrl);

export type { SchedulePersistenceInputPort, ScheduleComputationResultDto };
