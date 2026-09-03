import { describe, expect, it } from "vitest";

import { migrateDatabaseForTest } from "../src/platform/database/migrate.js";

describe("migration test hook", () => {
  it("rejects custom migration SQL outside test environments", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      await expect(
        migrateDatabaseForTest("postgres://unused", [
          { name: "unsafe.sql", sql: "SELECT 1" },
        ]),
      ).rejects.toThrow("test environments");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
