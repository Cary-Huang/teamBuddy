import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("returns a stable API health payload", () => {
    expect(new HealthController().read()).toEqual({
      status: "ok",
      service: "api",
    });
  });
});
