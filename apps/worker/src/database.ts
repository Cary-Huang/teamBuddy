import postgres, { type Sql } from "postgres";

export interface WorkerDatabase {
  sql: Sql;
  close(): Promise<void>;
}

export const createWorkerDatabase = (databaseUrl: string): WorkerDatabase => {
  const sql = postgres(databaseUrl, { max: 10 });
  return {
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
};

export const readWorkerDatabaseUrl = (): string => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return databaseUrl;
};
