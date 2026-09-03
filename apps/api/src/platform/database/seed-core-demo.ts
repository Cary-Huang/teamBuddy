import { createHash } from "node:crypto";

import postgres, { type Sql } from "postgres";

import { readDatabaseUrl } from "./client.js";

export const CORE_DEMO_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
export const CORE_DEMO_TEAM_ID = "70fc9bea-9d01-5174-8d0d-8a66b183a4f2";
export const CORE_DEMO_START_DATE = "2026-09-07";

const memberNames = [
  "演示成员 01",
  "演示成员 02",
  "演示成员 03",
  "演示成员 04",
  "演示成员 05",
  "演示成员 06",
  "演示成员 07",
  "演示成员 08",
  "演示成员 09",
  "演示成员 10",
] as const;
const priorities = ["P0", "P1", "P2", "P3"] as const;

export interface CoreDemoFixture {
  teamId: string;
  members: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; priority: (typeof priorities)[number] }>;
  tasks: Array<{
    id: string;
    projectId: string;
    memberId: string;
    milestoneId: string;
    status: "NOT_STARTED" | "BLOCKED" | "COMPLETED";
    remainingHours: number;
  }>;
  dependencies: Array<{ predecessorTaskId: string; successorTaskId: string }>;
  capacityExceptions: Array<{
    id: string;
    memberId: string;
    date: string;
    availableHours: number;
    reason: string;
  }>;
}

export interface CoreDemoSeedCounts {
  members: number;
  projects: number;
  tasks: number;
  dependencies: number;
  capacityExceptions: number;
}

export const createCoreDemoFixture = (): CoreDemoFixture => {
  const members = memberNames.map((name, index) => ({
    id: uuidV5(`member:${index + 1}`),
    name,
  }));
  const projects = Array.from({ length: 10 }, (_, index) => ({
    id: uuidV5(`project:${index + 1}`),
    priority: priorities[index % priorities.length]!,
  }));
  const milestones = projects.map((project, index) => ({
    id: uuidV5(`milestone:${index + 1}`),
    projectId: project.id,
  }));
  const tasks = Array.from({ length: 300 }, (_, index) => {
    const taskNumber = index + 1;
    const projectIndex = Math.floor(index / 30);
    const status: CoreDemoFixture["tasks"][number]["status"] =
      taskNumber % 31 === 0
        ? "COMPLETED"
        : taskNumber % 29 === 0
          ? "BLOCKED"
          : "NOT_STARTED";
    return {
      id: uuidV5(`task:${taskNumber}`),
      projectId: projects[projectIndex]!.id,
      memberId: members[index % members.length]!.id,
      milestoneId: milestones[projectIndex]!.id,
      status,
      remainingHours: status === "COMPLETED" ? 0 : 6 + (index % 3) * 3,
    };
  });
  const dependencies = projects.flatMap((_, projectIndex) => {
    const first = projectIndex * 30;
    return Array.from({ length: 20 }, (_, offset) => ({
      predecessorTaskId: tasks[first + offset]!.id,
      successorTaskId: tasks[first + offset + 1]!.id,
    }));
  });
  const capacityExceptions = [
    [0, "2026-09-09", "演示请假"],
    [1, "2026-09-16", "客户现场支持"],
    [2, "2026-09-23", "培训"],
    [3, "2026-09-30", "调休"],
  ].map(([memberIndex, date, reason], index) => ({
    id: uuidV5(`capacity-exception:${index + 1}`),
    memberId: members[Number(memberIndex)]!.id,
    date: String(date),
    availableHours: 0,
    reason: String(reason),
  }));

  return {
    teamId: CORE_DEMO_TEAM_ID,
    members,
    projects,
    tasks,
    dependencies,
    capacityExceptions,
  };
};

export const seedCoreDemo = async (
  sql: Sql,
  fixture = createCoreDemoFixture(),
): Promise<CoreDemoSeedCounts> => {
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO team.teams (id, name, timezone, default_daily_hours)
      VALUES (${fixture.teamId}, 'TeamBuddy Core Demo 2026', 'Asia/Shanghai', 8)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        timezone = EXCLUDED.timezone,
        default_daily_hours = EXCLUDED.default_daily_hours,
        updated_at = now()
    `;

    for (const member of fixture.members) {
      await tx`
        INSERT INTO team.members (id, team_id, name, status, default_daily_hours)
        VALUES (${member.id}, ${fixture.teamId}, ${member.name}, 'ACTIVE', 8)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          status = EXCLUDED.status,
          default_daily_hours = EXCLUDED.default_daily_hours,
          updated_at = now()
      `;
    }
    for (const exception of fixture.capacityExceptions) {
      await tx`
        INSERT INTO team.capacity_exceptions
          (id, member_id, date, available_hours, reason)
        VALUES
          (${exception.id}, ${exception.memberId}, ${exception.date}, ${exception.availableHours}, ${exception.reason})
        ON CONFLICT (id) DO UPDATE SET
          date = EXCLUDED.date,
          available_hours = EXCLUDED.available_hours,
          reason = EXCLUDED.reason,
          updated_at = now()
      `;
    }

    for (const [index, project] of fixture.projects.entries()) {
      await tx`
        INSERT INTO portfolio.projects
          (id, team_id, name, priority, target_date, owner_member_id, status, health)
        VALUES
          (${project.id}, ${fixture.teamId}, ${`核心演示项目 ${index + 1}`}, ${project.priority}, ${addDays(CORE_DEMO_START_DATE, 35 + index)}, ${fixture.members[index]!.id}, 'IN_PROGRESS', 'HEALTHY')
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          priority = EXCLUDED.priority,
          target_date = EXCLUDED.target_date,
          owner_member_id = EXCLUDED.owner_member_id,
          status = EXCLUDED.status,
          health = EXCLUDED.health,
          updated_at = now()
      `;
      const milestoneId = uuidV5(`milestone:${index + 1}`);
      await tx`
        INSERT INTO portfolio.milestones (id, project_id, name, target_date, manual_rank)
        VALUES (${milestoneId}, ${project.id}, ${`核心里程碑 ${index + 1}`}, ${addDays(CORE_DEMO_START_DATE, 28 + index)}, 0)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          target_date = EXCLUDED.target_date,
          manual_rank = EXCLUDED.manual_rank,
          updated_at = now()
      `;
    }

    for (const [index, task] of fixture.tasks.entries()) {
      const estimatedHours = task.remainingHours || 6;
      await tx`
        INSERT INTO work.tasks
          (id, project_id, milestone_id, assignee_id, name, estimated_hours, remaining_hours, status, manual_rank, locked)
        VALUES
          (${task.id}, ${task.projectId}, ${task.milestoneId}, ${task.memberId}, ${`核心演示任务 ${index + 1}`}, ${estimatedHours}, ${task.remainingHours}, ${task.status}, ${index % 30}, false)
        ON CONFLICT (id) DO UPDATE SET
          milestone_id = EXCLUDED.milestone_id,
          assignee_id = EXCLUDED.assignee_id,
          name = EXCLUDED.name,
          estimated_hours = EXCLUDED.estimated_hours,
          remaining_hours = EXCLUDED.remaining_hours,
          status = EXCLUDED.status,
          manual_rank = EXCLUDED.manual_rank,
          updated_at = now()
      `;
    }
    for (const dependency of fixture.dependencies) {
      await tx`
        INSERT INTO work.task_dependencies (id, predecessor_task_id, successor_task_id)
        VALUES (${uuidV5(`dependency:${dependency.predecessorTaskId}:${dependency.successorTaskId}`)}, ${dependency.predecessorTaskId}, ${dependency.successorTaskId})
        ON CONFLICT (predecessor_task_id, successor_task_id) DO NOTHING
      `;
    }
  });

  return {
    members: fixture.members.length,
    projects: fixture.projects.length,
    tasks: fixture.tasks.length,
    dependencies: fixture.dependencies.length,
    capacityExceptions: fixture.capacityExceptions.length,
  };
};

export const seedCoreDemoDatabase = async (
  databaseUrl: string,
): Promise<CoreDemoSeedCounts> => {
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    return await seedCoreDemo(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
};

const uuidV5 = (value: string): string => {
  const hash = createHash("sha1")
    .update(Buffer.from(CORE_DEMO_NAMESPACE.replaceAll("-", ""), "hex"))
    .update(value)
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const addDays = (date: string, count: number): string => {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
};

if (require.main === module) {
  void seedCoreDemoDatabase(readDatabaseUrl())
    .then((counts) =>
      console.info("Seeded TeamBuddy core demo", {
        ...counts,
        teamId: CORE_DEMO_TEAM_ID,
      }),
    )
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
