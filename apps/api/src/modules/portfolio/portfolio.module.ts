import { Module } from "@nestjs/common";

import type { DatabaseClient } from "../../platform/database/client.js";
import { DATABASE_CLIENT } from "../../platform/database/database.module.js";
import { TeamModule } from "../team/team.module.js";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { PortfolioController } from "./portfolio.controller.js";
import {
  DrizzlePortfolioRepository,
  PORTFOLIO_REPOSITORY,
} from "./portfolio.repository.js";
import { PortfolioService } from "./portfolio.service.js";

@Module({
  imports: [TeamModule, TaxonomyModule],
  controllers: [PortfolioController],
  providers: [
    {
      provide: PORTFOLIO_REPOSITORY,
      inject: [DATABASE_CLIENT],
      useFactory: (database: DatabaseClient) =>
        new DrizzlePortfolioRepository(database),
    },
    PortfolioService,
  ],
  exports: [PORTFOLIO_REPOSITORY, PortfolioService],
})
export class PortfolioModule {}
