import { describe, expect, it, vi } from "vitest";

import { initializeDatabase, readCoreDemoSeedEnabled } from "./initialize.js";

describe("database initialization", () => {
  it("runs migrations before the optional core demo seed", async () => {
    const calls: string[] = [];
    const migrate = vi.fn(async () => {
      calls.push("migrate");
    });
    const seed = vi.fn(async () => {
      calls.push("seed");
    });

    await initializeDatabase("postgres://database.test/teambuddy", true, {
      migrate,
      seed,
    });

    expect(calls).toEqual(["migrate", "seed"]);
  });

  it("skips demo data unless it is explicitly enabled", async () => {
    const migrate = vi.fn(async () => undefined);
    const seed = vi.fn(async () => undefined);

    await initializeDatabase("postgres://database.test/teambuddy", false, {
      migrate,
      seed,
    });

    expect(migrate).toHaveBeenCalledOnce();
    expect(seed).not.toHaveBeenCalled();
  });

  it("parses supported seed flags and rejects ambiguous values", () => {
    expect(readCoreDemoSeedEnabled(undefined)).toBe(false);
    expect(readCoreDemoSeedEnabled("false")).toBe(false);
    expect(readCoreDemoSeedEnabled("0")).toBe(false);
    expect(readCoreDemoSeedEnabled("true")).toBe(true);
    expect(readCoreDemoSeedEnabled("1")).toBe(true);
    expect(() => readCoreDemoSeedEnabled("yes")).toThrow(
      "SEED_CORE_DEMO must be one of: true, false, 1, 0",
    );
  });
});
