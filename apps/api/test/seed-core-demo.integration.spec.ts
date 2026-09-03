import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CORE_DEMO_TEAM_ID,
  createCoreDemoFixture,
  seedCoreDemo,
} from "../src/platform/database/seed-core-demo.js";
import { createDatabaseClient } from "../src/platform/database/client.js";
import { migrateDatabase } from "../src/platform/database/migrate.js";

const baseDatabaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = baseDatabaseUrl ? describe : describe.skip;

describeWithDatabase("core demo seed", () => {
  const databaseName = `teambuddy_task9_seed_${randomUUID().replaceAll("-", "")}`;
  const isolatedDatabaseUrl = new URL(
    baseDatabaseUrl ?? "postgres://localhost",
  );
  isolatedDatabaseUrl.pathname = `/${databaseName}`;
  const admin = postgres(baseDatabaseUrl ?? "", { max: 1 });
  let connection: ReturnType<typeof createDatabaseClient> | undefined;
  let databaseCreated = false;

  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    databaseCreated = true;
    await migrateDatabase(isolatedDatabaseUrl.toString());
    connection = createDatabaseClient(isolatedDatabaseUrl.toString());
  });

  beforeEach(async () => {
    if (!connection)
      throw new Error("Isolated seed test database was not created");
    await connection.sql.unsafe(`
      TRUNCATE TABLE
        platform.outbox_events,
        planning.task_allocation_overrides,
        planning.schedule_allocations,
        planning.schedule_versions,
        work.task_dependencies,
        work.tasks,
        portfolio.milestones,
        portfolio.projects,
        team.capacity_exceptions,
        team.members,
        team.teams
      CASCADE
    `);
  });

  afterAll(async () => {
    await connection?.close();
    if (databaseCreated) {
      await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    }
    await admin.end({ timeout: 5 });
  });

  it("is deterministic and contains the required scheduling fixtures", () => {
    const first = createCoreDemoFixture();
    const second = createCoreDemoFixture();

    expect(second).toEqual(first);
    expect(first.teamId).toBe(CORE_DEMO_TEAM_ID);
    expect(first.members).toHaveLength(10);
    expect(first.projects).toHaveLength(10);
    expect(first.tasks).toHaveLength(300);
    expect(new Set(first.projects.map((project) => project.priority))).toEqual(
      new Set(["P0", "P1", "P2", "P3"]),
    );
    expect(first.dependencies.length).toBeGreaterThan(0);
    expect(
      first.capacityExceptions.every((item) => item.availableHours === 0),
    ).toBe(true);
    expect(first.tasks.some((task) => task.status === "COMPLETED")).toBe(true);
    expect(first.tasks.some((task) => task.status === "BLOCKED")).toBe(true);
  });

  it("upserts only its fixed records and remains idempotent", async () => {
    if (!connection)
      throw new Error("Isolated seed test database was not created");
    const fixture = createCoreDemoFixture();
    await seedCoreDemo(connection.sql, fixture);
    await seedCoreDemo(connection.sql, fixture);

    const [members] = await connection.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM team.members WHERE team_id = ${CORE_DEMO_TEAM_ID}
    `;
    const [projects] = await connection.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM portfolio.projects WHERE team_id = ${CORE_DEMO_TEAM_ID}
    `;
    const [tasks] = await connection.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM work.tasks
    `;
    const [dependencies] = await connection.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM work.task_dependencies
    `;
    const [exceptions] = await connection.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM team.capacity_exceptions
    `;
    expect({
      members: Number(members?.count),
      projects: Number(projects?.count),
      tasks: Number(tasks?.count),
      dependencies: Number(dependencies?.count),
      capacityExceptions: Number(exceptions?.count),
    }).toEqual({
      members: 10,
      projects: 10,
      tasks: 300,
      dependencies: 200,
      capacityExceptions: 4,
    });

    const userMemberId = randomUUID();
    await connection.sql`
      INSERT INTO team.members (id, team_id, name, status, default_daily_hours)
      VALUES (${userMemberId}, ${CORE_DEMO_TEAM_ID}, '用户新增成员', 'ACTIVE', 6)
    `;
    await seedCoreDemo(connection.sql, fixture);
    const [userMember] = await connection.sql<{ id: string }[]>`
      SELECT id FROM team.members WHERE id = ${userMemberId}
    `;
    expect(userMember?.id).toBe(userMemberId);
  });
});
