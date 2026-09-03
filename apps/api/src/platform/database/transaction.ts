import type { DatabaseClient, DbTransaction } from "./client.js";

export interface DatabaseTransaction {
  run<T>(work: (tx: DbTransaction) => Promise<T>): Promise<T>;
}

export class PostgresDatabaseTransaction implements DatabaseTransaction {
  constructor(private readonly database: DatabaseClient) {}

  run<T>(work: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }
}
