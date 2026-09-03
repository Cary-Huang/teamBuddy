import type {
  CreateTaskDto,
  TaskDependencyDto,
  TaskDto,
  UpdateTaskDto,
  WorkSnapshotDto,
} from "@teambuddy/contracts";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type {
  DatabaseClient,
  DbTransaction,
} from "../../platform/database/client.js";
import { taskDependencies, tasks } from "./work.schema.js";

export const WORK_REPOSITORY = Symbol("WORK_REPOSITORY");

export interface WorkRepository {
  createTask(tx: DbTransaction, input: CreateTaskDto): Promise<TaskDto>;
  getTask(taskId: string): Promise<TaskDto | null>;
  getTaskForUpdate(tx: DbTransaction, taskId: string): Promise<TaskDto | null>;
  listTasks(projectId: string): Promise<TaskDto[]>;
  updateTask(
    tx: DbTransaction,
    taskId: string,
    input: UpdateTaskDto,
  ): Promise<TaskDto>;
  lockProjectDependencies(tx: DbTransaction, projectId: string): Promise<void>;
  readProjectDependencies(
    tx: DbTransaction,
    projectId: string,
  ): Promise<TaskDependencyDto[]>;
  addDependency(tx: DbTransaction, input: TaskDependencyDto): Promise<boolean>;
  readWorkSnapshot(teamId: string): Promise<WorkSnapshotDto>;
}

export interface ProjectScopeReader {
  listProjectIds(teamId: string): Promise<string[]>;
}

type TaskRow = typeof tasks.$inferSelect;

const toTaskDto = (row: TaskRow): TaskDto => ({
  id: row.id,
  projectId: row.projectId,
  milestoneId: row.milestoneId ?? undefined,
  parentTaskId: row.parentTaskId ?? undefined,
  assigneeId: row.assigneeId,
  name: row.name,
  estimatedHours: row.estimatedHours,
  remainingHours: row.remainingHours,
  status: row.status,
  manualRank: row.manualRank,
  locked: row.locked,
  createdAt: row.createdAt.toISOString(),
});

export class DrizzleWorkRepository implements WorkRepository {
  constructor(
    private readonly database: DatabaseClient,
    private readonly projectScope: ProjectScopeReader,
  ) {}

  async createTask(tx: DbTransaction, input: CreateTaskDto): Promise<TaskDto> {
    const [row] = await tx.insert(tasks).values(input).returning();
    if (!row) throw new Error("Failed to create task");
    return toTaskDto(row);
  }

  async getTask(taskId: string): Promise<TaskDto | null> {
    const [row] = await this.database
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    return row ? toTaskDto(row) : null;
  }

  async getTaskForUpdate(
    tx: DbTransaction,
    taskId: string,
  ): Promise<TaskDto | null> {
    const [row] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
      .for("update");
    return row ? toTaskDto(row) : null;
  }

  async listTasks(projectId: string): Promise<TaskDto[]> {
    const rows = await this.database
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.createdAt), asc(tasks.id));
    return rows.map(toTaskDto);
  }

  async updateTask(
    tx: DbTransaction,
    taskId: string,
    input: UpdateTaskDto,
  ): Promise<TaskDto> {
    const [row] = await tx
      .update(tasks)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning();
    if (!row) throw new Error(`Task ${taskId} was not found`);
    return toTaskDto(row);
  }

  async addDependency(
    tx: DbTransaction,
    input: TaskDependencyDto,
  ): Promise<boolean> {
    const inserted = await tx
      .insert(taskDependencies)
      .values(input)
      .onConflictDoNothing({
        target: [
          taskDependencies.predecessorTaskId,
          taskDependencies.successorTaskId,
        ],
      })
      .returning({ id: taskDependencies.id });
    return inserted.length > 0;
  }

  async lockProjectDependencies(
    tx: DbTransaction,
    projectId: string,
  ): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`work:project-dependencies:${projectId}`}, 0))`,
    );
  }

  async readProjectDependencies(
    tx: DbTransaction,
    projectId: string,
  ): Promise<TaskDependencyDto[]> {
    const projectTasks = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.projectId, projectId));
    if (projectTasks.length === 0) return [];

    const taskIds = projectTasks.map(({ id }) => id);
    const rows = await tx
      .select({
        predecessorTaskId: taskDependencies.predecessorTaskId,
        successorTaskId: taskDependencies.successorTaskId,
      })
      .from(taskDependencies)
      .where(
        and(
          inArray(taskDependencies.predecessorTaskId, taskIds),
          inArray(taskDependencies.successorTaskId, taskIds),
        ),
      );
    return rows;
  }

  async readWorkSnapshot(teamId: string): Promise<WorkSnapshotDto> {
    const projectIds = await this.projectScope.listProjectIds(teamId);
    if (projectIds.length === 0) return { tasks: [], dependencies: [] };

    const rows = await this.database
      .select()
      .from(tasks)
      .where(inArray(tasks.projectId, projectIds));
    const taskIds = rows.map((row) => row.id);
    const dependencies =
      taskIds.length === 0
        ? []
        : await this.database
            .select()
            .from(taskDependencies)
            .where(
              and(
                inArray(taskDependencies.predecessorTaskId, taskIds),
                inArray(taskDependencies.successorTaskId, taskIds),
              ),
            );

    return {
      tasks: rows.map(toTaskDto),
      dependencies: dependencies.map((dependency) => ({
        predecessorTaskId: dependency.predecessorTaskId,
        successorTaskId: dependency.successorTaskId,
      })),
    };
  }
}
