import { describe, expect, it, vi } from "vitest";

import { createPollingRunner, createWorkerLifecycle } from "./bootstrap.js";

describe("createPollingRunner", () => {
  it("does not overlap polls and waits for the in-flight poll on shutdown", async () => {
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const poll = vi.fn(async () => inFlight);
    const runner = createPollingRunner(poll, 1);

    runner.start();
    runner.start();
    expect(poll).toHaveBeenCalledTimes(1);
    const shutdown = runner.shutdown();
    let stopped = false;
    void shutdown.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await shutdown;
    expect(stopped).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(poll).toHaveBeenCalledTimes(1);
  });
});

describe("createWorkerLifecycle", () => {
  it("memoizes concurrent shutdown and closes each resource once", async () => {
    const runner = { start: vi.fn(), shutdown: vi.fn(async () => undefined) };
    const firstClose = vi.fn(async () => undefined);
    const secondClose = vi.fn(async () => undefined);
    const lifecycle = createWorkerLifecycle(
      runner,
      [firstClose, secondClose],
      { error: vi.fn() },
      "worker-a",
    );

    await Promise.all([lifecycle.shutdown(), lifecycle.shutdown()]);

    expect(runner.shutdown).toHaveBeenCalledTimes(1);
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it("logs shutdown failures without rejecting callers", async () => {
    const error = vi.fn();
    const lifecycle = createWorkerLifecycle(
      {
        start: vi.fn(),
        shutdown: vi.fn(async () => {
          throw new Error("poll");
        }),
      },
      [
        async () => {
          throw new Error("close");
        },
      ],
      { error },
      "worker-a",
    );

    await expect(lifecycle.shutdown()).resolves.toBeUndefined();
    await expect(lifecycle.shutdown()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("shutdown failed"),
      expect.objectContaining({ workerId: "worker-a" }),
    );
  });
});
