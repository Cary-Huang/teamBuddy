import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateTagGroupRequestDto,
  CreateTagRequestDto,
  ProjectTagsDto,
  ReplaceProjectTagsRequestDto,
  TagDto,
  TagGroupDto,
  TaxonomyDto,
  UpdateTagGroupRequestDto,
  UpdateTagRequestDto,
} from "@teambuddy/contracts";

import { DATABASE_TRANSACTION } from "../../platform/database/database.module.js";
import type { DbTransaction } from "../../platform/database/client.js";
import type { DatabaseTransaction } from "../../platform/database/transaction.js";
import {
  domainConflict,
  notFound,
} from "../../platform/http/application-error.js";
import {
  TEAM_REPOSITORY,
  type TeamRepository,
} from "../team/team.repository.js";
import {
  TAXONOMY_REPOSITORY,
  type TaxonomyRepository,
} from "./taxonomy.repository.js";

@Injectable()
export class TaxonomyService {
  constructor(
    @Inject(DATABASE_TRANSACTION)
    private readonly transaction: DatabaseTransaction,
    @Inject(TEAM_REPOSITORY)
    private readonly teamRepository: TeamRepository,
    @Inject(TAXONOMY_REPOSITORY)
    private readonly repository: TaxonomyRepository,
  ) {}

  async list(teamId: string): Promise<TaxonomyDto> {
    await this.requireTeam(teamId);
    await this.ensureDefaults(teamId);
    return this.repository.list(teamId);
  }

  async createGroup(
    teamId: string,
    input: CreateTagGroupRequestDto,
  ): Promise<TagGroupDto> {
    await this.requireTeam(teamId);
    this.validateGroupConfiguration(input.scope, input.requiredOnProject);
    return this.transaction.run((tx) =>
      this.repository.createGroup(tx, teamId, input),
    );
  }

  async updateGroup(
    teamId: string,
    groupId: string,
    input: UpdateTagGroupRequestDto,
  ): Promise<TagGroupDto> {
    const group = await this.requireGroupInTeam(groupId, teamId);
    this.validateGroupConfiguration(
      input.scope ?? group.scope,
      input.requiredOnProject ?? group.requiredOnProject,
    );
    return this.transaction.run((tx) =>
      this.repository.updateGroup(tx, groupId, input),
    );
  }

  async createTag(teamId: string, input: CreateTagRequestDto): Promise<TagDto> {
    const group = await this.requireGroupInTeam(input.groupId, teamId);
    if (group.status !== "ACTIVE") {
      throw domainConflict(
        "TAG_GROUP_ARCHIVED",
        "Archived groups cannot accept new tags",
      );
    }
    return this.transaction.run((tx) =>
      this.repository.createTag(tx, teamId, input),
    );
  }

  async updateTag(
    teamId: string,
    tagId: string,
    input: UpdateTagRequestDto,
  ): Promise<TagDto> {
    await this.requireTagInTeam(tagId, teamId);
    return this.transaction.run((tx) =>
      this.repository.updateTag(tx, tagId, input),
    );
  }

  async replaceProjectTags(
    teamId: string,
    projectId: string,
    input: ReplaceProjectTagsRequestDto,
  ): Promise<ProjectTagsDto> {
    await this.requireTeam(teamId);
    const projectTeamId = await this.repository.getProjectTeamId(projectId);
    if (!projectTeamId)
      throw notFound("PROJECT_NOT_FOUND", `Project ${projectId} was not found`);
    if (projectTeamId !== teamId) {
      throw domainConflict(
        "PROJECT_NOT_IN_TEAM",
        `Project ${projectId} does not belong to team ${teamId}`,
      );
    }
    const selected = await this.validateProjectTags(teamId, input.tagIds);
    await this.transaction.run((tx) =>
      this.repository.replaceProjectTags(tx, projectId, teamId, input.tagIds),
    );
    return { projectId, tags: selected };
  }

  async validateProjectTags(
    teamId: string,
    tagIds: string[],
  ): Promise<TagDto[]> {
    await this.ensureDefaults(teamId);
    const uniqueIds = [...new Set(tagIds)];
    const [{ groups }, selected] = await Promise.all([
      this.repository.list(teamId),
      this.repository.getTagsByIds(uniqueIds),
    ]);
    if (selected.length !== uniqueIds.length) {
      throw domainConflict(
        "TAG_NOT_IN_TEAM",
        "Every selected tag must belong to this team",
      );
    }
    if (
      selected.some((tag) => tag.teamId !== teamId || tag.status !== "ACTIVE")
    ) {
      throw domainConflict(
        "TAG_NOT_ASSIGNABLE",
        "Only active tags from this team can be assigned",
      );
    }
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    const counts = new Map<string, number>();
    for (const tag of selected) {
      const group = groupsById.get(tag.groupId);
      if (!group || group.status !== "ACTIVE" || group.scope === "TASK") {
        throw domainConflict(
          "TAG_NOT_ASSIGNABLE",
          "Tag group does not allow project assignments",
        );
      }
      counts.set(group.id, (counts.get(group.id) ?? 0) + 1);
    }
    for (const group of groups) {
      const count = counts.get(group.id) ?? 0;
      if (group.status !== "ACTIVE" || group.scope === "TASK") continue;
      if (group.selectionMode === "SINGLE" && count > 1) {
        throw domainConflict(
          "TAG_GROUP_SINGLE_ONLY",
          `${group.name} allows only one tag`,
        );
      }
      if (group.requiredOnProject && count === 0) {
        throw domainConflict(
          "REQUIRED_PROJECT_TAG_MISSING",
          `${group.name} is required`,
        );
      }
    }
    return selected;
  }

  async replaceProjectTagsInTransaction(
    tx: DbTransaction,
    teamId: string,
    projectId: string,
    tagIds: string[],
  ): Promise<void> {
    await this.repository.replaceProjectTags(tx, projectId, teamId, tagIds);
  }

  private async requireTeam(teamId: string): Promise<void> {
    if (!(await this.teamRepository.getTeam(teamId))) {
      throw notFound("TEAM_NOT_FOUND", `Team ${teamId} was not found`);
    }
  }

  private async ensureDefaults(teamId: string): Promise<void> {
    await this.transaction.run((tx) =>
      this.repository.ensureDefaults(tx, teamId),
    );
  }

  private async requireGroupInTeam(
    groupId: string,
    teamId: string,
  ): Promise<TagGroupDto> {
    const group = await this.repository.getGroup(groupId);
    if (!group)
      throw notFound(
        "TAG_GROUP_NOT_FOUND",
        `Tag group ${groupId} was not found`,
      );
    if (group.teamId !== teamId)
      throw domainConflict(
        "TAG_GROUP_NOT_IN_TEAM",
        "Tag group belongs to another team",
      );
    return group;
  }

  private async requireTagInTeam(
    tagId: string,
    teamId: string,
  ): Promise<TagDto> {
    const tag = await this.repository.getTag(tagId);
    if (!tag) throw notFound("TAG_NOT_FOUND", `Tag ${tagId} was not found`);
    if (tag.teamId !== teamId)
      throw domainConflict("TAG_NOT_IN_TEAM", "Tag belongs to another team");
    return tag;
  }

  private validateGroupConfiguration(
    scope: TagGroupDto["scope"],
    requiredOnProject = false,
  ): void {
    if (scope === "TASK" && requiredOnProject) {
      throw domainConflict(
        "INVALID_TAG_GROUP_CONFIGURATION",
        "Task-only groups cannot be required on projects",
      );
    }
  }
}
