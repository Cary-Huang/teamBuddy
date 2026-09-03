import { Module } from "@nestjs/common";

import { DATABASE_CLIENT } from "../../platform/database/database.module.js";
import type { DatabaseClient } from "../../platform/database/client.js";
import { TeamController } from "./team.controller.js";
import { DrizzleTeamRepository, TEAM_REPOSITORY } from "./team.repository.js";
import { TeamService } from "./team.service.js";

@Module({
  controllers: [TeamController],
  providers: [
    {
      provide: TEAM_REPOSITORY,
      inject: [DATABASE_CLIENT],
      useFactory: (database: DatabaseClient) =>
        new DrizzleTeamRepository(database),
    },
    TeamService,
  ],
  exports: [TEAM_REPOSITORY, TeamService],
})
export class TeamModule {}
