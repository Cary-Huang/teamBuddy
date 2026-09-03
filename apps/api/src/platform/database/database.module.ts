import {
  Global,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";

import {
  createDatabaseClient,
  readDatabaseUrl,
  type DatabaseClient,
  type DatabaseConnection,
} from "./client.js";
import { PostgresDatabaseTransaction } from "./transaction.js";
import { DrizzleOutboxRepository } from "../outbox/outbox.repository.js";

export const DATABASE_CLIENT = Symbol("DATABASE_CLIENT");
export const DATABASE_TRANSACTION = Symbol("DATABASE_TRANSACTION");
export const OUTBOX_REPOSITORY = Symbol("OUTBOX_REPOSITORY");

@Injectable()
class DatabaseConnectionProvider implements OnApplicationShutdown {
  readonly connection: DatabaseConnection =
    createDatabaseClient(readDatabaseUrl());

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}

@Global()
@Module({
  providers: [
    DatabaseConnectionProvider,
    {
      provide: DATABASE_CLIENT,
      inject: [DatabaseConnectionProvider],
      useFactory: (provider: DatabaseConnectionProvider): DatabaseClient =>
        provider.connection.db,
    },
    {
      provide: DATABASE_TRANSACTION,
      inject: [DATABASE_CLIENT],
      useFactory: (database: DatabaseClient) =>
        new PostgresDatabaseTransaction(database),
    },
    {
      provide: OUTBOX_REPOSITORY,
      useFactory: () => new DrizzleOutboxRepository(),
    },
  ],
  exports: [DATABASE_CLIENT, DATABASE_TRANSACTION, OUTBOX_REPOSITORY],
})
export class DatabaseModule {}
