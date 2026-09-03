import { describe, expect, it, vi } from "vitest";

import { RecalculationWaitError, waitForDraft } from "./schedule-view.js";

const oldDraft = {
  id: "11111111-1111-4111-8111-111111111111",
  teamId: "22222222-2222-4222-8222-222222222222",
  sourceEventId: "33333333-3333-4333-8333-333333333333",
  status: "DRAFT" as const,
  createdAt: "2026-09-02T00:00:00.000Z",
  allocations: [],
};

describe("waitForDraft", () => {
  it("does not return an existing draft from a different recalculate event", async () => {
    const getLatest = vi
      .fn()
      .mockResolvedValueOnce(oldDraft)
      .mockResolvedValueOnce({
        ...oldDraft,
        sourceEventId: "44444444-4444-4444-8444-444444444444",
      });

    await expect(
      waitForDraft({
        eventId: "44444444-4444-4444-8444-444444444444",
        getLatest,
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toMatchObject({
      sourceEventId: "44444444-4444-4444-8444-444444444444",
    });
    expect(getLatest).toHaveBeenCalledTimes(2);
  });

  it("reports a clear timeout after the polling limit", async () => {
    await expect(
      waitForDraft({
        eventId: "44444444-4444-4444-8444-444444444444",
        getLatest: vi.fn().mockResolvedValue(oldDraft),
        maxAttempts: 2,
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toMatchObject({
      code: "DRAFT_TIMEOUT",
    });
  });

  it("preserves an explicit abort while waiting for a matching draft", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForDraft({
        eventId: "44444444-4444-4444-8444-444444444444",
        getLatest: vi.fn(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
