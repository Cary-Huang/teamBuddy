import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { HealthController } from "./health.controller.js";
import { PortfolioModule } from "./modules/portfolio/portfolio.module.js";
import { PlanningModule } from "./modules/planning/planning.module.js";
import { TeamModule } from "./modules/team/team.module.js";
import { TaxonomyModule } from "./modules/taxonomy/taxonomy.module.js";
import { WorkModule } from "./modules/work/work.module.js";
import { DatabaseModule } from "./platform/database/database.module.js";
import { ApiErrorFilter } from "./platform/http/error.filter.js";

@Module({
  imports: [
    DatabaseModule,
    TeamModule,
    TaxonomyModule,
    PortfolioModule,
    WorkModule,
    PlanningModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
})
export class AppModule {}
