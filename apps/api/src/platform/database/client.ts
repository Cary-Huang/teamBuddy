import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

const createDrizzleClient = (sql: Sql) => drizzle(sql);

export type DatabaseClient = ReturnType<typeof createDrizzleClient>;
export type DbTransaction = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

export interface DatabaseConnection {
  db: DatabaseClient;
  sql: Sql;
  close(): Promise<void>;
}

export const createDatabaseClient = (
  databaseUrl: string,
): DatabaseConnection => {
  const sql = postgres(databaseUrl, { max: 10 });

  return {
    db: createDrizzleClient(sql),
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
};

export const readDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return databaseUrl;
};
