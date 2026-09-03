import type {
  CreateTagGroupRequestDto,
  CreateTagRequestDto,
  TagDto,
  TagGroupDto,
  TaxonomyDto,
  UpdateTagGroupRequestDto,
  UpdateTagRequestDto,
} from "@teambuddy/contracts";
import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";

import type {
  DatabaseClient,
  DbTransaction,
} from "../../platform/database/client.js";
import {
  projects,
  projectTagAssignments,
} from "../portfolio/portfolio.schema.js";
import { tagGroups, tags } from "./taxonomy.schema.js";

export const TAXONOMY_REPOSITORY = Symbol("TAXONOMY_REPOSITORY");

export interface TaxonomyRepository {
  ensureDefaults(tx: DbTransaction, teamId: string): Promise<void>;
  list(teamId: string): Promise<TaxonomyDto>;
  getGroup(groupId: string): Promise<TagGroupDto | null>;
  getTag(tagId: string): Promise<TagDto | null>;
  getTagsByIds(tagIds: string[]): Promise<TagDto[]>;
  getProjectTeamId(projectId: string): Promise<string | null>;
  createGroup(
    tx: DbTransaction,
    teamId: string,
    input: CreateTagGroupRequestDto,
  ): Promise<TagGroupDto>;
  updateGroup(
    tx: DbTransaction,
    groupId: string,
    input: UpdateTagGroupRequestDto,
  ): Promise<TagGroupDto>;
  createTag(
    tx: DbTransaction,
    teamId: string,
    input: CreateTagRequestDto,
  ): Promise<TagDto>;
  updateTag(
    tx: DbTransaction,
    tagId: string,
    input: UpdateTagRequestDto,
  ): Promise<TagDto>;
  replaceProjectTags(
    tx: DbTransaction,
    projectId: string,
    teamId: string,
    tagIds: string[],
  ): Promise<void>;
}

type TagGroupRow = typeof tagGroups.$inferSelect;
type TagRow = typeof tags.$inferSelect;

export const toTagGroupDto = (row: TagGroupRow): TagGroupDto => ({
  id: row.id,
  teamId: row.teamId,
  code: row.code,
  name: row.name,
  selectionMode: row.selectionMode,
  scope: row.scope,
  requiredOnProject: row.requiredOnProject,
  status: row.status,
  displayOrder: row.displayOrder,
  createdAt: row.createdAt.toISOString(),
});

export const toTagDto = (row: TagRow): TagDto => ({
  id: row.id,
  teamId: row.teamId,
  groupId: row.groupId,
  code: row.code,
  name: row.name,
  color: row.color,
  ...(row.description ? { description: row.description } : {}),
  status: row.status,
  displayOrder: row.displayOrder,
  createdAt: row.createdAt.toISOString(),
});

export class DrizzleTaxonomyRepository implements TaxonomyRepository {
  constructor(private readonly database: DatabaseClient) {}

  async ensureDefaults(tx: DbTransaction, teamId: string): Promise<void> {
    await tx
      .insert(tagGroups)
      .values([
        {
          teamId,
          code: "project_source",
          name: "项目来源",
          selectionMode: "SINGLE",
          scope: "PROJECT",
          requiredOnProject: false,
          displayOrder: 10,
        },
        {
          teamId,
          code: "work_type",
          name: "工作类型",
          selectionMode: "SINGLE",
          scope: "BOTH",
          requiredOnProject: false,
          displayOrder: 20,
        },
      ])
      .onConflictDoNothing({ target: [tagGroups.teamId, tagGroups.code] });
    const groups = await tx
      .select({ id: tagGroups.id, code: tagGroups.code })
      .from(tagGroups)
      .where(eq(tagGroups.teamId, teamId));
    const groupIdByCode = new Map(groups.map(({ id, code }) => [code, id]));
    const defaults = [
      ["project_source", "fulfillment", "履约", "#7c3aed", 10],
      ["work_type", "product_iteration", "产品迭代", "#2563eb", 10],
      ["work_type", "technical_improvement", "技术改造", "#0891b2", 20],
      ["work_type", "bugfix", "Bugfix", "#dc2626", 30],
    ] as const;
    await tx
      .insert(tags)
      .values(
        defaults.map(([groupCode, code, name, color, displayOrder]) => ({
          teamId,
          groupId: groupIdByCode.get(groupCode)!,
          code,
          name,
          color,
          displayOrder,
        })),
      )
      .onConflictDoNothing({ target: [tags.teamId, tags.code] });
  }

  async list(teamId: string): Promise<TaxonomyDto> {
    const [groupRows, tagRows] = await Promise.all([
      this.database
        .select()
        .from(tagGroups)
        .where(eq(tagGroups.teamId, teamId))
        .orderBy(asc(tagGroups.displayOrder), asc(tagGroups.name)),
      this.database
        .select()
        .from(tags)
        .where(eq(tags.teamId, teamId))
        .orderBy(asc(tags.displayOrder), asc(tags.name)),
    ]);
    return {
      groups: groupRows.map(toTagGroupDto),
      tags: tagRows.map(toTagDto),
    };
  }

  async getGroup(groupId: string): Promise<TagGroupDto | null> {
    const [row] = await this.database
      .select()
      .from(tagGroups)
      .where(eq(tagGroups.id, groupId))
      .limit(1);
    return row ? toTagGroupDto(row) : null;
  }

  async getTag(tagId: string): Promise<TagDto | null> {
    const [row] = await this.database
      .select()
      .from(tags)
      .where(eq(tags.id, tagId))
      .limit(1);
    return row ? toTagDto(row) : null;
  }

  async getTagsByIds(tagIds: string[]): Promise<TagDto[]> {
    if (tagIds.length === 0) return [];
    return (
      await this.database.select().from(tags).where(inArray(tags.id, tagIds))
    ).map(toTagDto);
  }

  async getProjectTeamId(projectId: string): Promise<string | null> {
    const [row] = await this.database
      .select({ teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return row?.teamId ?? null;
  }

  async createGroup(
    tx: DbTransaction,
    teamId: string,
    input: CreateTagGroupRequestDto,
  ): Promise<TagGroupDto> {
    const [row] = await tx
      .insert(tagGroups)
      .values({
        teamId,
        ...input,
        requiredOnProject: input.requiredOnProject ?? false,
        displayOrder: input.displayOrder ?? 0,
      })
      .returning();
    if (!row) throw new Error("Failed to create tag group");
    return toTagGroupDto(row);
  }

  async updateGroup(
    tx: DbTransaction,
    groupId: string,
    input: UpdateTagGroupRequestDto,
  ): Promise<TagGroupDto> {
    const [row] = await tx
      .update(tagGroups)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tagGroups.id, groupId))
      .returning();
    if (!row) throw new Error(`Tag group ${groupId} was not found`);
    return toTagGroupDto(row);
  }

  async createTag(
    tx: DbTransaction,
    teamId: string,
    input: CreateTagRequestDto,
  ): Promise<TagDto> {
    const [row] = await tx
      .insert(tags)
      .values({
        teamId,
        ...input,
        color: input.color ?? "#2563eb",
        displayOrder: input.displayOrder ?? 0,
      })
      .returning();
    if (!row) throw new Error("Failed to create tag");
    return toTagDto(row);
  }

  async updateTag(
    tx: DbTransaction,
    tagId: string,
    input: UpdateTagRequestDto,
  ): Promise<TagDto> {
    const [row] = await tx
      .update(tags)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tags.id, tagId))
      .returning();
    if (!row) throw new Error(`Tag ${tagId} was not found`);
    return toTagDto(row);
  }

  async replaceProjectTags(
    tx: DbTransaction,
    projectId: string,
    teamId: string,
    tagIds: string[],
  ): Promise<void> {
    const current = await tx
      .select({ tagId: projectTagAssignments.tagId })
      .from(projectTagAssignments)
      .where(
        and(
          eq(projectTagAssignments.projectId, projectId),
          isNull(projectTagAssignments.removedAt),
        ),
      );
    const desired = [...new Set(tagIds)];
    const removedAt = new Date();
    const removalCondition =
      desired.length === 0
        ? and(
            eq(projectTagAssignments.projectId, projectId),
            isNull(projectTagAssignments.removedAt),
          )
        : and(
            eq(projectTagAssignments.projectId, projectId),
            isNull(projectTagAssignments.removedAt),
            notInArray(projectTagAssignments.tagId, desired),
          );
    await tx
      .update(projectTagAssignments)
      .set({ removedAt, updatedAt: removedAt })
      .where(removalCondition);

    const currentIds = new Set(current.map(({ tagId }) => tagId));
    const additions = desired.filter((tagId) => !currentIds.has(tagId));
    if (additions.length > 0) {
      await tx
        .insert(projectTagAssignments)
        .values(additions.map((tagId) => ({ projectId, teamId, tagId })));
    }
  }
}
