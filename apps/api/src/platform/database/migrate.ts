import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import postgres from "postgres";

import { readDatabaseUrl } from "./client.js";

const migrationNames = [
  "0001_core.sql",
  "0002_outbox_processing.sql",
  "0003_outbox_claims_and_manual_overrides.sql",
  "0004_eight_hour_workday.sql",
  "0005_project_taxonomy.sql",
] as const;
const migrationDirectory = resolve(__dirname, "migrations");

export interface DatabaseMigration {
  name: string;
  sql: string;
}

const bootstrapSql = `
  DO $outer$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgcrypto') THEN
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
    ELSIF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'uuid-ossp') THEN
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    ELSE
      IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'gen_random_uuid'
          AND n.nspname = 'public'
      ) THEN
        CREATE OR REPLACE FUNCTION public.gen_random_uuid()
        RETURNS uuid
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.proname = 'uuid_generate_v4'
              AND n.nspname = 'public'
          ) THEN
            RETURN public.uuid_generate_v4();
          END IF;

          RETURN (md5(random()::text || clock_timestamp()::text || random()::text)::uuid);
        END;
        $fn$;
      END IF;
    END IF;
  END
  $outer$;

  CREATE SCHEMA IF NOT EXISTS platform;
  CREATE TABLE IF NOT EXISTS platform.schema_migrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    applied_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

const readDefaultMigrations = async (): Promise<DatabaseMigration[]> =>
  Promise.all(
    migrationNames.map(async (name) => ({
      name,
      sql: await readFile(resolve(migrationDirectory, name), "utf8"),
    })),
  );

const runMigrations = async (
  databaseUrl: string,
  migrations: readonly DatabaseMigration[],
) => {
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('teambuddy_schema_migrations'))`;
      await tx.unsafe(bootstrapSql);

      for (const migration of migrations) {
        const applied = await tx<{ name: string }[]>`
          SELECT name
          FROM platform.schema_migrations
          WHERE name = ${migration.name}
        `;

        if (applied.length > 0) continue;

        await tx.unsafe(migration.sql);
        await tx`
          INSERT INTO platform.schema_migrations (name)
          VALUES (${migration.name})
        `;
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
};

export const migrateDatabase = async (databaseUrl: string) =>
  runMigrations(databaseUrl, await readDefaultMigrations());

export const migrateDatabaseForTest = async (
  databaseUrl: string,
  migrations: readonly DatabaseMigration[],
) => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Custom migrations are restricted to test environments");
  }
  return runMigrations(databaseUrl, migrations);
};

if (require.main === module) {
  void migrateDatabase(readDatabaseUrl());
}
