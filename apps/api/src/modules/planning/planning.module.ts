import { Module } from "@nestjs/common";

import type { DatabaseClient } from "../../platform/database/client.js";
import { DATABASE_CLIENT } from "../../platform/database/database.module.js";
import { TeamModule } from "../team/team.module.js";
import { WorkModule } from "../work/work.module.js";
import {
  DrizzleManualOverrideRepository,
  MANUAL_OVERRIDE_REPOSITORY,
} from "./manual-override.repository.js";
import { PlanningController } from "./planning.controller.js";
import {
  DrizzlePlanningRepository,
  PLANNING_REPOSITORY,
} from "./planning.repository.js";
import { PlanningService } from "./planning.service.js";

@Module({
  imports: [TeamModule, WorkModule],
  controllers: [PlanningController],
  providers: [
    {
      provide: PLANNING_REPOSITORY,
      inject: [DATABASE_CLIENT],
      useFactory: (database: DatabaseClient) =>
        new DrizzlePlanningRepository(database),
    },
    {
      provide: MANUAL_OVERRIDE_REPOSITORY,
      inject: [DATABASE_CLIENT],
      useFactory: (database: DatabaseClient) =>
        new DrizzleManualOverrideRepository(database),
    },
    PlanningService,
  ],
})
export class PlanningModule {}
