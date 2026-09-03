import { describe, expect, it, vi } from "vitest";
import type { TagDto, TagGroupDto, TaxonomyDto } from "@teambuddy/contracts";

import type { DatabaseTransaction } from "../../platform/database/transaction.js";
import type { TeamRepository } from "../team/team.repository.js";
import type { TaxonomyRepository } from "./taxonomy.repository.js";
import { TaxonomyService } from "./taxonomy.service.js";

const teamId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-09-03T00:00:00.000Z";

const group = (
  input: Partial<TagGroupDto> & Pick<TagGroupDto, "id" | "code" | "name">,
): TagGroupDto => ({
  teamId,
  selectionMode: "SINGLE",
  scope: "PROJECT",
  requiredOnProject: false,
  status: "ACTIVE",
  displayOrder: 0,
  createdAt,
  ...input,
});

const tag = (
  input: Partial<TagDto> & Pick<TagDto, "id" | "groupId" | "code" | "name">,
): TagDto => ({
  teamId,
  color: "#2563eb",
  status: "ACTIVE",
  displayOrder: 0,
  createdAt,
  ...input,
});

const createService = ({
  taxonomy,
  selected = [],
  projectTeamId = teamId,
}: {
  taxonomy: TaxonomyDto;
  selected?: TagDto[];
  projectTeamId?: string | null;
}) => {
  const tx = {} as never;
  const repository = {
    ensureDefaults: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(taxonomy),
    getGroup: vi.fn().mockResolvedValue(taxonomy.groups[0]),
    getTagsByIds: vi.fn().mockResolvedValue(selected),
    getProjectTeamId: vi.fn().mockResolvedValue(projectTeamId),
    replaceProjectTags: vi.fn().mockResolvedValue(undefined),
  } as unknown as TaxonomyRepository;
  const transaction = {
    run: vi.fn(async (callback: (value: never) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as DatabaseTransaction;
  const teamRepository = {
    getTeam: vi.fn().mockResolvedValue({ id: teamId }),
  } as unknown as TeamRepository;
  return {
    repository,
    service: new TaxonomyService(transaction, teamRepository, repository),
  };
};

describe("TaxonomyService", () => {
  it("rejects task-only groups that are required on projects", async () => {
    const { service } = createService({
      taxonomy: { groups: [], tags: [] },
    });

    await expect(
      service.createGroup(teamId, {
        code: "task_type",
        name: "任务类型",
        selectionMode: "SINGLE",
        scope: "TASK",
        requiredOnProject: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TAG_GROUP_CONFIGURATION" });
  });

  it("rejects two tags from a single-select group", async () => {
    const workType = group({
      id: "33333333-3333-4333-8333-333333333333",
      code: "work_type",
      name: "工作类型",
    });
    const selected = [
      tag({
        id: "44444444-4444-4444-8444-444444444444",
        groupId: workType.id,
        code: "bugfix",
        name: "Bugfix",
      }),
      tag({
        id: "55555555-5555-4555-8555-555555555555",
        groupId: workType.id,
        code: "product_iteration",
        name: "产品迭代",
      }),
    ];
    const { service } = createService({
      taxonomy: { groups: [workType], tags: selected },
      selected,
    });

    await expect(
      service.validateProjectTags(
        teamId,
        selected.map(({ id }) => id),
      ),
    ).rejects.toMatchObject({ code: "TAG_GROUP_SINGLE_ONLY" });
  });

  it("enforces required project groups", async () => {
    const workType = group({
      id: "33333333-3333-4333-8333-333333333333",
      code: "work_type",
      name: "工作类型",
      requiredOnProject: true,
    });
    const { service } = createService({
      taxonomy: { groups: [workType], tags: [] },
    });

    await expect(service.validateProjectTags(teamId, [])).rejects.toMatchObject(
      { code: "REQUIRED_PROJECT_TAG_MISSING" },
    );
  });

  it("does not allow task-only tags on projects", async () => {
    const taskGroup = group({
      id: "33333333-3333-4333-8333-333333333333",
      code: "task_type",
      name: "任务类型",
      scope: "TASK",
    });
    const selected = [
      tag({
        id: "44444444-4444-4444-8444-444444444444",
        groupId: taskGroup.id,
        code: "frontend",
        name: "前端",
      }),
    ];
    const { service } = createService({
      taxonomy: { groups: [taskGroup], tags: selected },
      selected,
    });

    await expect(
      service.validateProjectTags(teamId, [selected[0]!.id]),
    ).rejects.toMatchObject({ code: "TAG_NOT_ASSIGNABLE" });
  });

  it("replaces validated project tags within the owning team", async () => {
    const source = group({
      id: "33333333-3333-4333-8333-333333333333",
      code: "project_source",
      name: "项目来源",
    });
    const selected = [
      tag({
        id: "44444444-4444-4444-8444-444444444444",
        groupId: source.id,
        code: "fulfillment",
        name: "履约",
      }),
    ];
    const { repository, service } = createService({
      taxonomy: { groups: [source], tags: selected },
      selected,
    });

    await expect(
      service.replaceProjectTags(teamId, projectId, {
        tagIds: [selected[0]!.id],
      }),
    ).resolves.toEqual({ projectId, tags: selected });
    expect(repository.replaceProjectTags).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
      teamId,
      [selected[0]!.id],
    );
  });

  it("rejects projects from another team", async () => {
    const { repository, service } = createService({
      taxonomy: { groups: [], tags: [] },
      projectTeamId: "99999999-9999-4999-8999-999999999999",
    });

    await expect(
      service.replaceProjectTags(teamId, projectId, { tagIds: [] }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_IN_TEAM" });
    expect(repository.replaceProjectTags).not.toHaveBeenCalled();
  });
});
