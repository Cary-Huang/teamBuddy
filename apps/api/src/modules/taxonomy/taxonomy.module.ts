import { Module } from "@nestjs/common";

import type { DatabaseClient } from "../../platform/database/client.js";
import { DATABASE_CLIENT } from "../../platform/database/database.module.js";
import { TeamModule } from "../team/team.module.js";
import { TaxonomyController } from "./taxonomy.controller.js";
import {
  DrizzleTaxonomyRepository,
  TAXONOMY_REPOSITORY,
} from "./taxonomy.repository.js";
import { TaxonomyService } from "./taxonomy.service.js";

@Module({
  imports: [TeamModule],
  controllers: [TaxonomyController],
  providers: [
    {
      provide: TAXONOMY_REPOSITORY,
      inject: [DATABASE_CLIENT],
      useFactory: (database: DatabaseClient) =>
        new DrizzleTaxonomyRepository(database),
    },
    TaxonomyService,
  ],
  exports: [TAXONOMY_REPOSITORY, TaxonomyService],
})
export class TaxonomyModule {}
