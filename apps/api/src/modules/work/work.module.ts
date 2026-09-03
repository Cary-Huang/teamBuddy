import { Module } from "@nestjs/common";

import type { DatabaseClient } from "../../platform/database/client.js";
import {
  DATABASE_CLIENT,
  DATABASE_TRANSACTION,
  OUTBOX_REPOSITORY,
} from "../../platform/database/database.module.js";
import type { DatabaseTransaction } from "../../platform/database/transaction.js";
import type { OutboxRepository } from "../../platform/outbox/outbox.repository.js";
import { PortfolioModule } from "../portfolio/portfolio.module.js";
import {
  PORTFOLIO_REPOSITORY,
  type PortfolioRepository,
} from "../portfolio/portfolio.repository.js";
import { TeamModule } from "../team/team.module.js";
import {
  TEAM_REPOSITORY,
  type TeamRepository,
} from "../team/team.repository.js";
import { CreateTaskCommand } from "./create-task.command.js";
import { PortfolioProjectScopeReader } from "./project-scope.adapter.js";
import { WorkController } from "./work.controller.js";
import {
  DrizzleWorkRepository,
  WORK_REPOSITORY,
  type WorkRepository,
} from "./work.repository.js";
import { WorkService } from "./work.service.js";

@Module({
  imports: [TeamModule, PortfolioModule],
  controllers: [WorkController],
  providers: [
    {
      provide: WORK_REPOSITORY,
      inject: [DATABASE_CLIENT, PORTFOLIO_REPOSITORY],
      useFactory: (
        database: DatabaseClient,
        portfolioRepository: PortfolioRepository,
      ) =>
        new DrizzleWorkRepository(
          database,
          new PortfolioProjectScopeReader(portfolioRepository),
        ),
    },
    {
      provide: CreateTaskCommand,
      inject: [
        DATABASE_TRANSACTION,
        TEAM_REPOSITORY,
        PORTFOLIO_REPOSITORY,
        WORK_REPOSITORY,
        OUTBOX_REPOSITORY,
      ],
      useFactory: (
        transaction: DatabaseTransaction,
        teamRepository: TeamRepository,
        portfolioRepository: PortfolioRepository,
        workRepository: WorkRepository,
        outboxRepository: OutboxRepository,
      ) =>
        new CreateTaskCommand(
          transaction,
          teamRepository,
          portfolioRepository,
          workRepository,
          outboxRepository,
        ),
    },
    WorkService,
  ],
  exports: [WORK_REPOSITORY, WorkService],
})
export class WorkModule {}
