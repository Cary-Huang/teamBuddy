import { describe, expect, it } from "vitest";

import { countInProgressProjects } from "./dashboard.js";

describe("countInProgressProjects", () => {
  it("counts only IN_PROGRESS projects", () => {
    expect(
      countInProgressProjects([
        { status: "PLANNING" },
        { status: "IN_PROGRESS" },
        { status: "PAUSED" },
        { status: "COMPLETED" },
      ]),
    ).toBe(1);
  });
});
