import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import {
  migrateDatabase,
  migrateDatabaseForTest,
} from "../src/platform/database/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("database migrations", () => {
  const adminUrl = databaseUrl ? new URL(databaseUrl) : undefined;
  if (adminUrl) adminUrl.pathname = "/postgres";
  const admin = adminUrl
    ? postgres(adminUrl.toString(), { max: 1 })
    : undefined;
  const testDatabases = new Set<string>();

  const createEmptyDatabase = async () => {
    const name = `teambuddy_task5_${randomUUID().replaceAll("-", "")}`;
    await admin!.unsafe(`CREATE DATABASE "${name}"`);
    testDatabases.add(name);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    return url.toString();
  };

  afterAll(async () => {
    for (const name of testDatabases) {
      await admin!.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    await admin!.end({ timeout: 5 });
  });

  it("serializes concurrent bootstrap and applies every physical migration once", async () => {
    const url = await createEmptyDatabase();

    await Promise.all([migrateDatabase(url), migrateDatabase(url)]);

    const sql = postgres(url, { max: 1 });
    try {
      const journal = await sql<{ name: string; value: number }[]>`
        SELECT name, count(*)::int AS value
        FROM platform.schema_migrations
        WHERE name IN ('0001_core.sql', '0002_outbox_processing.sql', '0003_outbox_claims_and_manual_overrides.sql', '0004_eight_hour_workday.sql', '0005_project_taxonomy.sql')
        GROUP BY name ORDER BY name
      `;
      expect(journal).toEqual([
        { name: "0001_core.sql", value: 1 },
        { name: "0002_outbox_processing.sql", value: 1 },
        { name: "0003_outbox_claims_and_manual_overrides.sql", value: 1 },
        { name: "0004_eight_hour_workday.sql", value: 1 },
        { name: "0005_project_taxonomy.sql", value: 1 },
      ]);

      const schemas = await sql<{ schemaName: string }[]>`
        SELECT schema_name AS "schemaName"
        FROM information_schema.schemata
        WHERE schema_name IN ('team', 'portfolio', 'work', 'planning', 'platform', 'taxonomy')
        ORDER BY schema_name
      `;
      expect(schemas.map(({ schemaName }) => schemaName)).toEqual([
        "planning",
        "platform",
        "portfolio",
        "taxonomy",
        "team",
        "work",
      ]);

      const [crossModuleForeignKeys] = await sql<{ value: number }[]>`
        SELECT count(*)::int AS value
        FROM pg_constraint constraint_record
        JOIN pg_class source_table ON source_table.oid = constraint_record.conrelid
        JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
        JOIN pg_class target_table ON target_table.oid = constraint_record.confrelid
        JOIN pg_namespace target_schema ON target_schema.oid = target_table.relnamespace
        WHERE constraint_record.contype = 'f'
          AND source_schema.nspname IN ('team', 'portfolio', 'work', 'planning', 'platform', 'taxonomy')
          AND source_schema.nspname <> target_schema.nspname
      `;
      expect(crossModuleForeignKeys?.value).toBe(0);

      const [invalidTableCount] = await sql<{ value: number }[]>`
        SELECT count(*)::int AS value
        FROM pg_class table_record
        JOIN pg_namespace schema_record ON schema_record.oid = table_record.relnamespace
        WHERE table_record.relkind = 'r'
          AND schema_record.nspname IN ('team', 'portfolio', 'work', 'planning', 'platform', 'taxonomy')
          AND (
            NOT EXISTS (
              SELECT 1
              FROM pg_constraint primary_key
              JOIN pg_attribute primary_key_column
                ON primary_key_column.attrelid = table_record.oid
                AND primary_key_column.attnum = primary_key.conkey[1]
              JOIN pg_type primary_key_type ON primary_key_type.oid = primary_key_column.atttypid
              WHERE primary_key.conrelid = table_record.oid
                AND primary_key.contype = 'p'
                AND cardinality(primary_key.conkey) = 1
                AND primary_key_type.typname = 'uuid'
            )
            OR NOT EXISTS (
              SELECT 1 FROM information_schema.columns audit_column
              WHERE audit_column.table_schema = schema_record.nspname
                AND audit_column.table_name = table_record.relname
                AND audit_column.column_name = 'created_at'
                AND audit_column.data_type = 'timestamp with time zone'
            )
            OR NOT EXISTS (
              SELECT 1 FROM information_schema.columns audit_column
              WHERE audit_column.table_schema = schema_record.nspname
                AND audit_column.table_name = table_record.relname
                AND audit_column.column_name = 'updated_at'
                AND audit_column.data_type = 'timestamp with time zone'
            )
          )
      `;
      expect(invalidTableCount?.value).toBe(0);

      const [fingerprintColumn] = await sql<
        { dataType: string; nullable: string }[]
      >`
        SELECT data_type AS "dataType", is_nullable AS nullable
        FROM information_schema.columns
        WHERE table_schema = 'planning'
          AND table_name = 'schedule_versions'
          AND column_name = 'result_fingerprint'
      `;
      expect(fingerprintColumn).toEqual({ dataType: "text", nullable: "NO" });

      const outboxColumns = await sql<{ columnName: string }[]>`
        SELECT column_name AS "columnName" FROM information_schema.columns
        WHERE table_schema = 'platform' AND table_name = 'outbox_events'
          AND column_name IN ('attempt_count', 'available_at', 'lease_expires_at', 'claim_token')
        ORDER BY column_name
      `;
      expect(outboxColumns.map(({ columnName }) => columnName)).toEqual([
        "attempt_count",
        "available_at",
        "claim_token",
        "lease_expires_at",
      ]);
      const [overrides] = await sql<{ value: number }[]>`
        SELECT count(*)::int AS value FROM information_schema.tables
        WHERE table_schema = 'planning' AND table_name = 'task_allocation_overrides'
      `;
      expect(overrides?.value).toBe(1);

      const indexes = await sql<{ indexName: string; definition: string }[]>`
        SELECT indexname AS "indexName", indexdef AS definition
        FROM pg_indexes
        WHERE (schemaname = 'platform' AND tablename = 'outbox_events'
          AND indexname = 'outbox_events_claim_token_index')
          OR (schemaname = 'planning' AND tablename = 'schedule_allocations'
          AND indexname = 'schedule_allocations_version_task_member_date_source_unique')
      `;
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            indexName: "outbox_events_claim_token_index",
            definition: expect.stringContaining(
              "(id, claimed_by, claim_token, lease_expires_at)",
            ),
          }),
          expect.objectContaining({
            indexName:
              "schedule_allocations_version_task_member_date_source_unique",
            definition: expect.stringContaining(
              "(schedule_version_id, task_id, member_id, date, source)",
            ),
          }),
        ]),
      );
      const constraints = await sql<{ name: string; definition: string }[]>`
        SELECT conname AS name, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE connamespace = 'planning'::regnamespace
          AND conname IN (
            'task_allocation_overrides_team_task_member_date_unique',
            'task_allocation_overrides_hours_check',
            'task_allocation_overrides_locked_check'
          )
        ORDER BY conname
      `;
      expect(constraints).toEqual([
        expect.objectContaining({
          name: "task_allocation_overrides_hours_check",
          definition: expect.stringMatching(/hours > /),
        }),
        expect.objectContaining({
          name: "task_allocation_overrides_locked_check",
          definition: expect.stringContaining("CHECK (locked)"),
        }),
        expect.objectContaining({
          name: "task_allocation_overrides_team_task_member_date_unique",
          definition: expect.stringContaining(
            "UNIQUE (team_id, task_id, member_id, date)",
          ),
        }),
      ]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("rolls back bootstrap, DDL and journal when a migration fails", async () => {
    const url = await createEmptyDatabase();

    await expect(
      migrateDatabaseForTest(url, [
        {
          name: "0001_failure.sql",
          sql: `
            CREATE SCHEMA rollback_probe;
            CREATE TABLE rollback_probe.items (id uuid PRIMARY KEY);
            SELECT task5_missing_function();
          `,
        },
      ]),
    ).rejects.toThrow();

    const sql = postgres(url, { max: 1 });
    try {
      const [state] = await sql<
        {
          platformSchema: boolean;
          probeSchema: boolean;
          journalTable: boolean;
        }[]
      >`
        SELECT
          EXISTS (
            SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform'
          ) AS "platformSchema",
          EXISTS (
            SELECT 1 FROM information_schema.schemata WHERE schema_name = 'rollback_probe'
          ) AS "probeSchema",
          to_regclass('platform.schema_migrations') IS NOT NULL AS "journalTable"
      `;
      expect(state).toEqual({
        platformSchema: false,
        probeSchema: false,
        journalTable: false,
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
