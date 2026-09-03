import { describe, expect, it, vi } from "vitest";

import {
  ApiClient,
  ApiClientError,
  resolveBrowserApiBaseUrl,
} from "./client.js";
import { resolveServerApiBaseUrl } from "../team-scope.js";

const member = {
  id: "11111111-1111-4111-8111-111111111111",
  teamId: "22222222-2222-4222-8222-222222222222",
  name: "张三",
  status: "ACTIVE" as const,
  defaultDailyHours: 6,
  createdAt: "2026-09-02T00:00:00.000Z",
};

describe("ApiClient", () => {
  it("adds and reuses a correlation id for a user action", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(member), { status: 201 }));
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetcher,
      createCorrelationId: () => "33333333-3333-4333-8333-333333333333",
    });

    await client.createMember(member.teamId, {
      name: "张三",
      status: "ACTIVE",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/v1/teams/22222222-2222-4222-8222-222222222222/members",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-correlation-id": "33333333-3333-4333-8333-333333333333",
        }),
      }),
    );
  });

  it("archives members and projects through their typed PATCH routes", async () => {
    const project = {
      id: "44444444-4444-4444-8444-444444444444",
      teamId: member.teamId,
      name: "支付重构",
      priority: "P0" as const,
      targetDate: "2026-09-30",
      status: "CANCELED" as const,
      health: "HEALTHY" as const,
      createdAt: "2026-09-02T00:00:00.000Z",
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...member, status: "INACTIVE" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(project), { status: 200 }),
      );
    const client = new ApiClient({ baseUrl: "http://api.test", fetcher });

    await client.updateMember(member.teamId, member.id, {
      status: "INACTIVE",
    });
    await client.updateProject(member.teamId, project.id, {
      status: "CANCELED",
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `http://api.test/v1/teams/${member.teamId}/members/${member.id}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "INACTIVE" }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `http://api.test/v1/teams/${member.teamId}/projects/${project.id}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "CANCELED" }),
      }),
    );
  });

  it("updates task status and a manual schedule window through typed routes", async () => {
    const task = {
      id: "55555555-5555-4555-8555-555555555555",
      projectId: "44444444-4444-4444-8444-444444444444",
      assigneeId: member.id,
      name: "支付接口联调",
      estimatedHours: 12,
      remainingHours: 12,
      status: "IN_PROGRESS" as const,
      manualRank: 0,
      locked: false,
      createdAt: "2026-09-02T00:00:00.000Z",
    };
    const queued = {
      eventId: "66666666-6666-4666-8666-666666666666",
      status: "queued" as const,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(task), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(queued), { status: 200 }),
      );
    const client = new ApiClient({ baseUrl: "http://api.test", fetcher });

    await client.updateTask(task.projectId, task.id, {
      status: "IN_PROGRESS",
    });
    await client.setTaskScheduleWindow(member.teamId, task.id, {
      startDate: "2026-09-07",
      endDate: "2026-09-11",
      adjustTaskHours: true,
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `http://api.test/v1/projects/${task.projectId}/tasks/${task.id}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `http://api.test/v1/teams/${member.teamId}/planning/tasks/${task.id}/window`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          startDate: "2026-09-07",
          endDate: "2026-09-11",
          adjustTaskHours: true,
        }),
      }),
    );
  });

  it("replaces project tags through the typed taxonomy route", async () => {
    const projectId = "44444444-4444-4444-8444-444444444444";
    const tag = {
      id: "77777777-7777-4777-8777-777777777777",
      teamId: member.teamId,
      groupId: "88888888-8888-4888-8888-888888888888",
      code: "bugfix",
      name: "Bugfix",
      color: "#dc2626",
      status: "ACTIVE" as const,
      displayOrder: 0,
      createdAt: "2026-09-03T00:00:00.000Z",
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ projectId, tags: [tag] }), {
        status: 200,
      }),
    );
    const client = new ApiClient({ baseUrl: "http://api.test", fetcher });

    await expect(
      client.replaceProjectTags(member.teamId, projectId, [tag.id]),
    ).resolves.toEqual({ projectId, tags: [tag] });
    expect(fetcher).toHaveBeenCalledWith(
      `http://api.test/v1/teams/${member.teamId}/projects/${projectId}/tags`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ tagIds: [tag.id] }),
      }),
    );
  });

  it("binds the default native fetch implementation to the global receiver", async () => {
    const nativeLikeFetch = vi.fn(function (this: typeof globalThis) {
      expect(this).toBe(globalThis);
      return Promise.resolve(
        new Response(JSON.stringify([member]), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", nativeLikeFetch);

    try {
      const client = new ApiClient({ baseUrl: "http://api.test" });

      await expect(client.listMembers(member.teamId)).resolves.toEqual([
        member,
      ]);
      expect(nativeLikeFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects malformed successful payloads", async () => {
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetcher: vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "not-a-uuid" }), { status: 200 }),
        ),
    });

    await expect(client.listMembers(member.teamId)).rejects.toMatchObject({
      name: "ApiClientError",
      code: "INVALID_RESPONSE",
      status: 200,
    });
  });

  it("maps the stable API error envelope to ApiClientError", async () => {
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetcher: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "TEAM_NOT_FOUND",
            message: "Team was not found",
            correlationId: "44444444-4444-4444-8444-444444444444",
          }),
          { status: 404 },
        ),
      ),
    });

    await expect(client.listMembers(member.teamId)).rejects.toEqual(
      new ApiClientError({
        status: 404,
        code: "TEAM_NOT_FOUND",
        message: "Team was not found",
        correlationId: "44444444-4444-4444-8444-444444444444",
      }),
    );
  });

  it("maps response body read failures to a correlated network error", async () => {
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetcher: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockRejectedValue(new Error("socket closed")),
      } as unknown as Response),
      createCorrelationId: () => "33333333-3333-4333-8333-333333333333",
    });

    await expect(client.listMembers(member.teamId)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      correlationId: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("preserves abort errors raised while reading a response body", async () => {
    const abort = { name: "AbortError" };
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetcher: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockRejectedValue(abort),
      } as unknown as Response),
    });

    await expect(client.listMembers(member.teamId)).rejects.toBe(abort);
  });

  it("separates browser build-time and server runtime API base URLs", () => {
    expect(resolveBrowserApiBaseUrl("https://browser.example.test")).toBe(
      "https://browser.example.test",
    );
    expect(resolveServerApiBaseUrl("http://api-runtime:3001")).toBe(
      "http://api-runtime:3001",
    );
    expect(resolveBrowserApiBaseUrl()).toBe("http://localhost:3001");
    expect(resolveServerApiBaseUrl()).toBe("http://localhost:3001");
  });
});
