import { randomUUID } from "node:crypto";

import {
  createMemberSchema,
  createMilestoneSchema,
  createProjectSchema,
  createTaskSchema,
  scheduleComputationResultSchema,
} from "@teambuddy/contracts";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { SchedulePersistenceInputResolver } from "../src/modules/planning/schedule-persistence-input.resolver.js";
import {
  DrizzlePlanningRepository,
  ScheduleSourceEventConflictError,
} from "../src/modules/planning/planning.repository.js";
import { scheduleVersions } from "../src/modules/planning/planning.schema.js";
import { DrizzlePortfolioRepository } from "../src/modules/portfolio/portfolio.repository.js";
import { DrizzleTeamRepository } from "../src/modules/team/team.repository.js";
import {
  CreateTaskCommand,
  TaskReferenceValidationError,
} from "../src/modules/work/create-task.command.js";
import { PortfolioProjectScopeReader } from "../src/modules/work/project-scope.adapter.js";
import { DrizzleWorkRepository } from "../src/modules/work/work.repository.js";
import { taskDependencies, tasks } from "../src/modules/work/work.schema.js";
import { createDatabaseClient } from "../src/platform/database/client.js";
import { PostgresDatabaseTransaction } from "../src/platform/database/transaction.js";
import { outboxEvents } from "../src/platform/outbox/outbox.schema.js";
import {
  DrizzleOutboxRepository,
  OutboxEventConflictError,
  type OutboxRepository,
} from "../src/platform/outbox/outbox.repository.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgreSQL repositories", () => {
  const connection = createDatabaseClient(databaseUrl!);
  const transaction = new PostgresDatabaseTransaction(connection.db);
  const teamRepository = new DrizzleTeamRepository(connection.db);
  const portfolioRepository = new DrizzlePortfolioRepository(connection.db);
  const projectScope = new PortfolioProjectScopeReader(portfolioRepository);
  const workRepository = new DrizzleWorkRepository(connection.db, projectScope);
  const outboxRepository = new DrizzleOutboxRepository();
  const createTaskCommand = new CreateTaskCommand(
    transaction,
    teamRepository,
    portfolioRepository,
    workRepository,
    outboxRepository,
  );
  const planningRepository = new DrizzlePlanningRepository(connection.db);
  const scheduleInputResolver = new SchedulePersistenceInputResolver(
    teamRepository,
    workRepository,
  );

  beforeEach(async () => {
    await connection.sql.unsafe(`
      TRUNCATE TABLE
        platform.outbox_events,
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
    await connection.close();
  });

  const createTeam = (name = "Core") =>
    transaction.run((tx) =>
      teamRepository.createTeam(tx, {
        name,
        timezone: "Asia/Shanghai",
        defaultDailyHours: 6,
      }),
    );

  const createMember = (teamId: string, name: string) =>
    transaction.run((tx) =>
      teamRepository.createMember(
        tx,
        createMemberSchema.parse({ teamId, name }),
      ),
    );

  const createProject = (
    teamId: string,
    name: string,
    priority: "P0" | "P1" | "P2" | "P3" = "P1",
  ) =>
    transaction.run((tx) =>
      portfolioRepository.createProject(
        tx,
        createProjectSchema.parse({
          teamId,
          name,
          priority,
          targetDate: "2026-10-01",
        }),
      ),
    );

  const createTask = (input: Parameters<typeof createTaskSchema.parse>[0]) =>
    createTaskCommand.execute(createTaskSchema.parse(input), {
      eventId: randomUUID(),
      correlationId: randomUUID(),
      requestedAt: new Date().toISOString(),
    });

  const createPlanningFixture = async (prefix: string) => {
    const team = await createTeam(`${prefix} Team`);
    const member = await createMember(team.id, `${prefix} Member`);
    const project = await createProject(team.id, `${prefix} Project`);
    const task = await createTask({
      projectId: project.id,
      assigneeId: member.id,
      name: `${prefix} Task`,
      estimatedHours: 4,
      remainingHours: 4,
    });
    return { team, member, project, task };
  };

  it("persists explicit team capacity and defaults members to eight hours", async () => {
    const team = await createTeam();
    const member = await createMember(team.id, "Lin");

    expect(team.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(member.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(team.defaultDailyHours).toBe(6);
    expect(member.defaultDailyHours).toBe(8);
  });

  it("persists a P0 project and milestone target date", async () => {
    const team = await createTeam();
    const project = await transaction.run((tx) =>
      portfolioRepository.createProject(
        tx,
        createProjectSchema.parse({
          teamId: team.id,
          name: "Launch",
          priority: "P0",
          targetDate: "2026-09-30",
        }),
      ),
    );
    const milestone = await transaction.run((tx) =>
      portfolioRepository.createMilestone(
        tx,
        createMilestoneSchema.parse({
          projectId: project.id,
          name: "Beta",
          targetDate: "2026-09-20",
        }),
      ),
    );

    expect(project.priority).toBe("P0");
    expect(project.targetDate).toBe("2026-09-30");
    expect(milestone.targetDate).toBe("2026-09-20");
  });

  it("updates member, project and milestone DTOs through owning repositories", async () => {
    const team = await createTeam("Updates");
    const member = await createMember(team.id, "Before Member");
    const project = await createProject(team.id, "Before Project", "P1");
    const milestone = await transaction.run((tx) =>
      portfolioRepository.createMilestone(
        tx,
        createMilestoneSchema.parse({
          projectId: project.id,
          name: "Before Milestone",
          targetDate: "2026-09-20",
        }),
      ),
    );

    const updatedMember = await transaction.run((tx) =>
      teamRepository.updateMember(tx, member.id, {
        name: "After Member",
        defaultDailyHours: 7,
      }),
    );
    const updatedProject = await transaction.run((tx) =>
      portfolioRepository.updateProject(tx, project.id, {
        priority: "P0",
        status: "IN_PROGRESS",
      }),
    );
    const updatedMilestone = await transaction.run((tx) =>
      portfolioRepository.updateMilestone(tx, milestone.id, {
        name: "After Milestone",
        manualRank: 1,
      }),
    );

    expect(updatedMember).toMatchObject({
      id: member.id,
      teamId: team.id,
      name: "After Member",
      defaultDailyHours: 7,
    });
    expect(updatedProject).toMatchObject({
      id: project.id,
      teamId: team.id,
      priority: "P0",
      status: "IN_PROGRESS",
    });
    expect(updatedMilestone).toMatchObject({
      id: milestone.id,
      projectId: project.id,
      name: "After Milestone",
      manualRank: 1,
    });
    await expect(
      portfolioRepository.getMilestone(milestone.id),
    ).resolves.toEqual(updatedMilestone);
    expect(Object.keys(updatedProject)).not.toContain("updated_at");
  });

  it("rejects a cross-team assignee through the production command without writes", async () => {
    const [projectTeam, memberTeam] = await Promise.all([
      createTeam("Project Team"),
      createTeam("Member Team"),
    ]);
    const member = await createMember(memberTeam.id, "Kai");
    const project = await createProject(projectTeam.id, "Boundary");

    const operation = createTask({
      projectId: project.id,
      assigneeId: member.id,
      name: "Must fail",
      estimatedHours: 4,
      remainingHours: 4,
    });
    await expect(operation).rejects.toBeInstanceOf(
      TaskReferenceValidationError,
    );
    await expect(operation).rejects.toMatchObject({
      code: "MEMBER_NOT_IN_TEAM",
    });

    const [[taskCount], [eventCount]] = await Promise.all([
      connection.db.select({ value: count() }).from(tasks),
      connection.db.select({ value: count() }).from(outboxEvents),
    ]);
    expect(taskCount?.value).toBe(0);
    expect(eventCount?.value).toBe(0);
  });

  it("rolls back a task when scheduling Outbox append fails", async () => {
    const team = await createTeam();
    const member = await createMember(team.id, "Atomic");
    const project = await createProject(team.id, "Atomic Project");
    const failingOutbox: OutboxRepository = {
      append: async () => {
        throw new Error("outbox unavailable");
      },
    };
    const command = new CreateTaskCommand(
      transaction,
      teamRepository,
      portfolioRepository,
      workRepository,
      failingOutbox,
    );

    await expect(
      command.execute(
        createTaskSchema.parse({
          projectId: project.id,
          assigneeId: member.id,
          name: "Rollback",
          estimatedHours: 4,
          remainingHours: 4,
        }),
        {
          eventId: randomUUID(),
          correlationId: randomUUID(),
          requestedAt: new Date().toISOString(),
        },
      ),
    ).rejects.toThrow("outbox unavailable");

    const [result] = await connection.db.select({ value: count() }).from(tasks);
    expect(result?.value).toBe(0);
  });

  it("adds dependencies idempotently and reads a team-scoped work snapshot", async () => {
    const [team, otherTeam] = await Promise.all([
      createTeam("Snapshot"),
      createTeam("Other Snapshot"),
    ]);
    const [member, otherMember] = await Promise.all([
      createMember(team.id, "Ming"),
      createMember(otherTeam.id, "Other"),
    ]);
    const [project, otherProject] = await Promise.all([
      createProject(team.id, "Dependency"),
      createProject(otherTeam.id, "Other Dependency"),
    ]);
    const [predecessor, successor, otherTask] = await Promise.all([
      createTask({
        projectId: project.id,
        assigneeId: member.id,
        name: "A",
        estimatedHours: 4,
        remainingHours: 4,
      }),
      createTask({
        projectId: project.id,
        assigneeId: member.id,
        name: "B",
        estimatedHours: 4,
        remainingHours: 4,
      }),
      createTask({
        projectId: otherProject.id,
        assigneeId: otherMember.id,
        name: "Other",
        estimatedHours: 4,
        remainingHours: 4,
      }),
    ]);
    const dependency = {
      predecessorTaskId: predecessor.id,
      successorTaskId: successor.id,
    };

    const insertionResults = await transaction.run(async (tx) => [
      await workRepository.addDependency(tx, dependency),
      await workRepository.addDependency(tx, dependency),
    ]);

    const snapshot = await workRepository.readWorkSnapshot(team.id);
    expect(snapshot.tasks.map(({ id }) => id).sort()).toEqual(
      [predecessor.id, successor.id].sort(),
    );
    expect(snapshot.tasks.map(({ id }) => id)).not.toContain(otherTask.id);
    expect(snapshot.dependencies).toEqual([dependency]);
    expect(insertionResults).toEqual([true, false]);

    const [result] = await connection.db
      .select({ value: count() })
      .from(taskDependencies)
      .where(eq(taskDependencies.predecessorTaskId, predecessor.id));
    expect(result?.value).toBe(1);
  });

  it("persists computed allocations with the created schedule version", async () => {
    const team = await createTeam("Planning");
    const member = await createMember(team.id, "Planner");
    const project = await createProject(team.id, "Plan Project");
    const task = await createTask({
      projectId: project.id,
      assigneeId: member.id,
      name: "Planned",
      estimatedHours: 6,
      remainingHours: 6,
    });
    const computation = scheduleComputationResultSchema.parse({
      allocations: [
        {
          taskId: task.id,
          memberId: member.id,
          date: "2026-09-03",
          hours: 6,
          source: "AUTOMATIC",
        },
      ],
      taskDates: {
        [task.id]: { start: "2026-09-03", end: "2026-09-03" },
      },
      warnings: [],
    });
    const input = await scheduleInputResolver.resolve(team.id, computation);
    const sourceEventId = randomUUID();

    const draft = await transaction.run((tx) =>
      planningRepository.createDraft(tx, sourceEventId, input),
    );
    const duplicate = await transaction.run((tx) =>
      planningRepository.createDraft(tx, sourceEventId, input),
    );
    const latest = await planningRepository.getLatest(team.id);

    expect(duplicate.id).toBe(draft.id);
    expect(latest?.allocations).toEqual([
      {
        scheduleVersionId: draft.id,
        ...computation.allocations[0],
      },
    ]);
    const [versionCount] = await connection.db
      .select({ value: count() })
      .from(scheduleVersions)
      .where(eq(scheduleVersions.sourceEventId, sourceEventId));
    expect(versionCount?.value).toBe(1);
  });

  it("rejects conflicting data for a duplicate schedule source event", async () => {
    const team = await createTeam("Planning Conflict");
    const member = await createMember(team.id, "Conflict Member");
    const project = await createProject(team.id, "Conflict Project");
    const task = await createTask({
      projectId: project.id,
      assigneeId: member.id,
      name: "Conflict Task",
      estimatedHours: 2,
      remainingHours: 2,
    });
    const sourceEventId = randomUUID();
    const original = await scheduleInputResolver.resolve(
      team.id,
      scheduleComputationResultSchema.parse({
        allocations: [
          {
            taskId: task.id,
            memberId: member.id,
            date: "2026-09-03",
            hours: 1,
            source: "AUTOMATIC",
          },
        ],
        taskDates: {},
        warnings: [],
      }),
    );
    await transaction.run((tx) =>
      planningRepository.createDraft(tx, sourceEventId, original),
    );

    await expect(
      transaction.run((tx) =>
        planningRepository.createDraft(tx, sourceEventId, {
          ...original,
          allocations: [{ ...original.allocations[0]!, hours: 2 }],
        }),
      ),
    ).rejects.toBeInstanceOf(ScheduleSourceEventConflictError);
  });

  it("treats reordered complete schedule results as idempotent", async () => {
    const {
      team,
      member,
      project,
      task: firstTask,
    } = await createPlanningFixture("Canonical");
    const secondTask = await createTask({
      projectId: project.id,
      assigneeId: member.id,
      name: "Canonical Second Task",
      estimatedHours: 4,
      remainingHours: 4,
    });
    const firstComputation = scheduleComputationResultSchema.parse({
      allocations: [
        {
          taskId: firstTask.id,
          memberId: member.id,
          date: "2026-09-03",
          hours: 2,
          source: "AUTOMATIC",
        },
        {
          taskId: secondTask.id,
          memberId: member.id,
          date: "2026-09-04",
          hours: 2,
          source: "AUTOMATIC",
        },
      ],
      taskDates: {
        [firstTask.id]: { start: "2026-09-03", end: "2026-09-03" },
        [secondTask.id]: { start: "2026-09-04", end: "2026-09-04" },
      },
      warnings: [
        { code: "TASK_BLOCKED", taskId: firstTask.id },
        { code: "TASK_OUTSIDE_HORIZON", taskId: secondTask.id },
      ],
    });
    const reorderedComputation = scheduleComputationResultSchema.parse({
      allocations: [...firstComputation.allocations].reverse(),
      taskDates: {
        [secondTask.id]: firstComputation.taskDates[secondTask.id],
        [firstTask.id]: firstComputation.taskDates[firstTask.id],
      },
      warnings: [...firstComputation.warnings].reverse(),
    });
    const [firstInput, reorderedInput] = await Promise.all([
      scheduleInputResolver.resolve(team.id, firstComputation),
      scheduleInputResolver.resolve(team.id, reorderedComputation),
    ]);
    const sourceEventId = randomUUID();

    const first = await transaction.run((tx) =>
      planningRepository.createDraft(tx, sourceEventId, firstInput),
    );
    const replay = await transaction.run((tx) =>
      planningRepository.createDraft(tx, sourceEventId, reorderedInput),
    );

    expect(replay.id).toBe(first.id);
  });

  it("rejects changed taskDates for an existing schedule source event", async () => {
    const { team, task } = await createPlanningFixture("Task Dates Conflict");
    const computation = scheduleComputationResultSchema.parse({
      allocations: [],
      taskDates: {
        [task.id]: { start: "2026-09-03", end: "2026-09-03" },
      },
      warnings: [],
    });
    const original = await scheduleInputResolver.resolve(team.id, computation);
    const sourceEventId = randomUUID();
    await transaction.run((tx) =>
      planningRepository.createDraft(tx, sourceEventId, original),
    );

    await expect(
      transaction.run((tx) =>
        planningRepository.createDraft(tx, sourceEventId, {
          ...original,
          taskDates: {
            [task.id]: { start: "2026-09-03", end: "2026-09-04" },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ScheduleSourceEventConflictError);
  });

  it("rejects changed warnings for an existing schedule source event", async () => {
    const { team, task } = await createPlanningFixture("Warning Conflict");
    const computation = scheduleComputationResultSchema.parse({
      allocations: [],
      taskDates: {},
      warnings: [{ code: "TASK_BLOCKED", taskId: task.id }],
    });
    const original = await scheduleInputResolver.resolve(team.id, computation);
    const sourceEventId = randomUUID();
    await transaction.run((tx) =>
      planningRepository.createDraft(tx, sourceEventId, original),
    );

    await expect(
      transaction.run((tx) =>
        planningRepository.createDraft(tx, sourceEventId, {
          ...original,
          warnings: [{ code: "TASK_OUTSIDE_HORIZON", taskId: task.id }],
        }),
      ),
    ).rejects.toBeInstanceOf(ScheduleSourceEventConflictError);
  });

  it("resolves schedule team scope before transactions and writes nothing on failure", async () => {
    const computation = scheduleComputationResultSchema.parse({
      allocations: [],
      taskDates: {},
      warnings: [],
    });

    await expect(
      scheduleInputResolver.resolve(randomUUID(), computation),
    ).rejects.toMatchObject({ code: "TEAM_NOT_FOUND" });

    const [result] = await connection.db
      .select({ value: count() })
      .from(scheduleVersions);
    expect(result?.value).toBe(0);
  });

  it("rejects schedule allocation references outside the resolved team scope", async () => {
    const [team, otherTeam] = await Promise.all([
      createTeam("Resolved Scope"),
      createTeam("Foreign Scope"),
    ]);
    const [member, otherMember] = await Promise.all([
      createMember(team.id, "Resolved Member"),
      createMember(otherTeam.id, "Foreign Member"),
    ]);
    const [project, otherProject] = await Promise.all([
      createProject(team.id, "Resolved Project"),
      createProject(otherTeam.id, "Foreign Project"),
    ]);
    const [task, otherTask] = await Promise.all([
      createTask({
        projectId: project.id,
        assigneeId: member.id,
        name: "Resolved Task",
        estimatedHours: 2,
        remainingHours: 2,
      }),
      createTask({
        projectId: otherProject.id,
        assigneeId: otherMember.id,
        name: "Foreign Task",
        estimatedHours: 2,
        remainingHours: 2,
      }),
    ]);
    const computation = (taskId: string, memberId: string) =>
      scheduleComputationResultSchema.parse({
        allocations: [
          {
            taskId,
            memberId,
            date: "2026-09-03",
            hours: 2,
            source: "AUTOMATIC",
          },
        ],
        taskDates: {},
        warnings: [],
      });

    await expect(
      scheduleInputResolver.resolve(
        team.id,
        computation(otherTask.id, member.id),
      ),
    ).rejects.toMatchObject({ code: "TASK_NOT_IN_TEAM" });
    await expect(
      scheduleInputResolver.resolve(
        team.id,
        computation(task.id, otherMember.id),
      ),
    ).rejects.toMatchObject({ code: "MEMBER_NOT_IN_TEAM" });

    const [result] = await connection.db
      .select({ value: count() })
      .from(scheduleVersions);
    expect(result?.value).toBe(0);
  });

  it("rejects taskDates references outside the resolved team scope", async () => {
    const { team } = await createPlanningFixture("Task Dates Scope");

    await expect(
      scheduleInputResolver.resolve(
        team.id,
        scheduleComputationResultSchema.parse({
          allocations: [],
          taskDates: {
            [randomUUID()]: { start: "2026-09-03", end: "2026-09-04" },
          },
          warnings: [],
        }),
      ),
    ).rejects.toMatchObject({ code: "TASK_NOT_IN_TEAM" });

    const [result] = await connection.db
      .select({ value: count() })
      .from(scheduleVersions);
    expect(result?.value).toBe(0);
  });

  it("rejects warning task references outside the resolved team scope", async () => {
    const { team } = await createPlanningFixture("Warning Scope");

    await expect(
      scheduleInputResolver.resolve(
        team.id,
        scheduleComputationResultSchema.parse({
          allocations: [],
          taskDates: {},
          warnings: [{ code: "TASK_BLOCKED", taskId: randomUUID() }],
        }),
      ),
    ).rejects.toMatchObject({ code: "TASK_NOT_IN_TEAM" });

    const [result] = await connection.db
      .select({ value: count() })
      .from(scheduleVersions);
    expect(result?.value).toBe(0);
  });

  it("rolls back an Outbox event when a business insert fails", async () => {
    await createTeam("Duplicate");
    const eventId = randomUUID();

    await expect(
      transaction.run(async (tx) => {
        await outboxRepository.append(tx, {
          eventId,
          type: "team.created.v1",
          correlationId: randomUUID(),
          aggregateId: randomUUID(),
          payload: { name: "Duplicate" },
          occurredAt: new Date().toISOString(),
        });
        await teamRepository.createTeam(tx, {
          name: "Duplicate",
          timezone: "Asia/Shanghai",
          defaultDailyHours: 6,
        });
      }),
    ).rejects.toThrow();

    const [result] = await connection.db
      .select({ value: count() })
      .from(outboxEvents)
      .where(eq(outboxEvents.eventId, eventId));
    expect(result?.value).toBe(0);
  });

  it("appends an Outbox event idempotently", async () => {
    const event = {
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      type: "team.created.v1",
      correlationId: randomUUID(),
      aggregateId: randomUUID(),
      payload: { name: "Once" },
      occurredAt: "2026-09-02T04:00:00.000Z",
    };

    await transaction.run(async (tx) => {
      await outboxRepository.append(tx, event);
      await outboxRepository.append(tx, event);
    });

    const [result] = await connection.db
      .select({ value: count() })
      .from(outboxEvents)
      .where(eq(outboxEvents.eventId, event.eventId));
    expect(result?.value).toBe(1);
  });

  it("rejects an Outbox append whose event ID and key match different rows", async () => {
    const first = {
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      type: "team.created.v1",
      correlationId: randomUUID(),
      aggregateId: randomUUID(),
      payload: { name: "First" },
      occurredAt: "2026-09-02T04:00:00.000Z",
    };
    const second = {
      ...first,
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      aggregateId: randomUUID(),
      payload: { name: "Second" },
    };
    await transaction.run(async (tx) => {
      await outboxRepository.append(tx, first);
      await outboxRepository.append(tx, second);
    });

    await expect(
      transaction.run((tx) =>
        outboxRepository.append(tx, {
          ...first,
          idempotencyKey: second.idempotencyKey,
        }),
      ),
    ).rejects.toBeInstanceOf(OutboxEventConflictError);

    const persistedEvents = await connection.db.select().from(outboxEvents);
    expect(persistedEvents).toHaveLength(2);
    expect(persistedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: first.eventId,
          idempotencyKey: first.idempotencyKey,
        }),
        expect.objectContaining({
          eventId: second.eventId,
          idempotencyKey: second.idempotencyKey,
        }),
      ]),
    );
  });

  it.each(["eventId", "idempotencyKey"] as const)(
    "rolls back a new task on an Outbox %s collision",
    async (collision) => {
      const team = await createTeam(`Outbox ${collision}`);
      const member = await createMember(team.id, `Outbox ${collision} Member`);
      const project = await createProject(
        team.id,
        `Outbox ${collision} Project`,
      );
      const eventId = randomUUID();
      const idempotencyKey = randomUUID();
      const requestedAt = "2026-09-02T04:00:00.000Z";
      const first = await createTaskCommand.execute(
        createTaskSchema.parse({
          projectId: project.id,
          assigneeId: member.id,
          name: "Original Task",
          estimatedHours: 2,
          remainingHours: 2,
        }),
        {
          eventId,
          idempotencyKey,
          correlationId: randomUUID(),
          requestedAt,
        },
      );

      await expect(
        createTaskCommand.execute(
          createTaskSchema.parse({
            projectId: project.id,
            assigneeId: member.id,
            name: "Conflicting Task",
            estimatedHours: 2,
            remainingHours: 2,
          }),
          {
            eventId: collision === "eventId" ? eventId : randomUUID(),
            idempotencyKey:
              collision === "idempotencyKey" ? idempotencyKey : randomUUID(),
            correlationId: randomUUID(),
            requestedAt,
          },
        ),
      ).rejects.toBeInstanceOf(OutboxEventConflictError);

      const [persistedTasks, persistedEvents] = await Promise.all([
        connection.db.select().from(tasks),
        connection.db.select().from(outboxEvents),
      ]);
      expect(persistedTasks.map(({ id }) => id)).toEqual([first.id]);
      expect(persistedEvents).toHaveLength(1);
      expect(persistedEvents[0]).toMatchObject({
        eventId,
        idempotencyKey,
        aggregateId: first.id,
      });
    },
  );
});
