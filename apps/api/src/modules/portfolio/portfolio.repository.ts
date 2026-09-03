import type {
  CreateMilestoneDto,
  CreateProjectDto,
  MilestoneDto,
  PortfolioSnapshotDto,
  ProjectDto,
  TagDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
} from "@teambuddy/contracts";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type {
  DatabaseClient,
  DbTransaction,
} from "../../platform/database/client.js";
import { tags } from "../taxonomy/taxonomy.schema.js";
import {
  milestones,
  projects,
  projectTagAssignments,
} from "./portfolio.schema.js";
import { toTagDto } from "../taxonomy/taxonomy.repository.js";

export const PORTFOLIO_REPOSITORY = Symbol("PORTFOLIO_REPOSITORY");

export interface PortfolioRepository {
  createProject(
    tx: DbTransaction,
    input: CreateProjectDto,
  ): Promise<ProjectDto>;
  getProject(projectId: string): Promise<ProjectDto | null>;
  getProjectForUpdate(
    tx: DbTransaction,
    projectId: string,
  ): Promise<ProjectDto | null>;
  listProjects(teamId: string): Promise<ProjectDto[]>;
  updateProject(
    tx: DbTransaction,
    projectId: string,
    input: UpdateProjectDto,
  ): Promise<ProjectDto>;
  createMilestone(
    tx: DbTransaction,
    input: CreateMilestoneDto,
  ): Promise<MilestoneDto>;
  getMilestone(milestoneId: string): Promise<MilestoneDto | null>;
  getMilestoneForUpdate(
    tx: DbTransaction,
    milestoneId: string,
  ): Promise<MilestoneDto | null>;
  listMilestones(projectId: string): Promise<MilestoneDto[]>;
  updateMilestone(
    tx: DbTransaction,
    milestoneId: string,
    input: UpdateMilestoneDto,
  ): Promise<MilestoneDto>;
  readPortfolioSnapshot(teamId: string): Promise<PortfolioSnapshotDto>;
}

type ProjectRow = typeof projects.$inferSelect;
type MilestoneRow = typeof milestones.$inferSelect;

const toProjectDto = (
  row: ProjectRow,
  projectTags: TagDto[] = [],
): ProjectDto => ({
  id: row.id,
  teamId: row.teamId,
  name: row.name,
  priority: row.priority,
  targetDate: row.targetDate,
  ownerMemberId: row.ownerMemberId ?? undefined,
  status: row.status,
  health: row.health,
  healthReason: row.healthReason ?? undefined,
  tags: projectTags,
  createdAt: row.createdAt.toISOString(),
});

const toMilestoneDto = (row: MilestoneRow): MilestoneDto => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  targetDate: row.targetDate,
  manualRank: row.manualRank,
  createdAt: row.createdAt.toISOString(),
});

export class DrizzlePortfolioRepository implements PortfolioRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createProject(
    tx: DbTransaction,
    input: CreateProjectDto,
  ): Promise<ProjectDto> {
    const { tagIds: _tagIds, ...projectInput } = input;
    const [row] = await tx.insert(projects).values(projectInput).returning();
    if (!row) throw new Error("Failed to create project");
    return toProjectDto(row);
  }

  async getProject(projectId: string): Promise<ProjectDto | null> {
    const [row] = await this.database
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!row) return null;
    const tagsByProject = await this.listProjectTags([projectId]);
    return toProjectDto(row, tagsByProject.get(projectId));
  }

  async getProjectForUpdate(
    tx: DbTransaction,
    projectId: string,
  ): Promise<ProjectDto | null> {
    const [row] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .for("update");
    return row ? toProjectDto(row) : null;
  }

  async listProjects(teamId: string): Promise<ProjectDto[]> {
    const rows = await this.database
      .select()
      .from(projects)
      .where(eq(projects.teamId, teamId))
      .orderBy(asc(projects.createdAt), asc(projects.id));
    const tagsByProject = await this.listProjectTags(rows.map(({ id }) => id));
    return rows.map((row) => toProjectDto(row, tagsByProject.get(row.id)));
  }

  async updateProject(
    tx: DbTransaction,
    projectId: string,
    input: UpdateProjectDto,
  ): Promise<ProjectDto> {
    const [row] = await tx
      .update(projects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning();
    if (!row) throw new Error(`Project ${projectId} was not found`);
    const tagsByProject = await this.listProjectTags([projectId]);
    return toProjectDto(row, tagsByProject.get(projectId));
  }

  async createMilestone(
    tx: DbTransaction,
    input: CreateMilestoneDto,
  ): Promise<MilestoneDto> {
    const [row] = await tx.insert(milestones).values(input).returning();
    if (!row) throw new Error("Failed to create milestone");
    return toMilestoneDto(row);
  }

  async getMilestone(milestoneId: string): Promise<MilestoneDto | null> {
    const [row] = await this.database
      .select()
      .from(milestones)
      .where(eq(milestones.id, milestoneId))
      .limit(1);
    return row ? toMilestoneDto(row) : null;
  }

  async getMilestoneForUpdate(
    tx: DbTransaction,
    milestoneId: string,
  ): Promise<MilestoneDto | null> {
    const [row] = await tx
      .select()
      .from(milestones)
      .where(eq(milestones.id, milestoneId))
      .limit(1)
      .for("update");
    return row ? toMilestoneDto(row) : null;
  }

  async listMilestones(projectId: string): Promise<MilestoneDto[]> {
    const rows = await this.database
      .select()
      .from(milestones)
      .where(eq(milestones.projectId, projectId))
      .orderBy(asc(milestones.createdAt), asc(milestones.id));
    return rows.map(toMilestoneDto);
  }

  async updateMilestone(
    tx: DbTransaction,
    milestoneId: string,
    input: UpdateMilestoneDto,
  ): Promise<MilestoneDto> {
    const [row] = await tx
      .update(milestones)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(milestones.id, milestoneId))
      .returning();
    if (!row) throw new Error(`Milestone ${milestoneId} was not found`);
    return toMilestoneDto(row);
  }

  async readPortfolioSnapshot(teamId: string): Promise<PortfolioSnapshotDto> {
    const projectDtos = await this.listProjects(teamId);
    const milestoneRows =
      projectDtos.length === 0
        ? []
        : await this.database
            .select()
            .from(milestones)
            .where(
              inArray(
                milestones.projectId,
                projectDtos.map((project) => project.id),
              ),
            );

    return {
      projects: projectDtos,
      milestones: milestoneRows.map(toMilestoneDto),
    };
  }

  private async listProjectTags(
    projectIds: string[],
  ): Promise<Map<string, TagDto[]>> {
    const result = new Map<string, TagDto[]>();
    if (projectIds.length === 0) return result;
    const rows = await this.database
      .select({ projectId: projectTagAssignments.projectId, tag: tags })
      .from(projectTagAssignments)
      .innerJoin(tags, eq(tags.id, projectTagAssignments.tagId))
      .where(
        and(
          inArray(projectTagAssignments.projectId, projectIds),
          isNull(projectTagAssignments.removedAt),
        ),
      )
      .orderBy(asc(tags.displayOrder), asc(tags.name));
    for (const row of rows) {
      const projectTags = result.get(row.projectId) ?? [];
      projectTags.push(toTagDto(row.tag));
      result.set(row.projectId, projectTags);
    }
    return result;
  }
}
