import { describe, expect, it, vi } from "vitest";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";

import { configureApiCors, createCorsOptions } from "./app-configuration.js";

class CorsTestModule {}
Reflect.defineMetadata("imports", [], CorsTestModule);
Reflect.defineMetadata("providers", [], CorsTestModule);

describe("API CORS configuration", () => {
  it("allows only the configured web origin and required headers", () => {
    const options = createCorsOptions(
      "https://web.example.test, http://localhost:3000",
    );
    expect(options).toMatchObject({
      methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-Correlation-Id", "Accept"],
      credentials: false,
    });
    const checkOrigin = (origin: string) =>
      new Promise<boolean>((resolve) =>
        options.origin(origin, (_error, allowed) => resolve(allowed)),
      );
    return expect(checkOrigin("https://web.example.test"))
      .resolves.toBe(true)
      .then(() =>
        expect(checkOrigin("http://localhost:3000")).resolves.toBe(true),
      )
      .then(() =>
        expect(checkOrigin("https://other.example.test")).resolves.toBe(false),
      );
  });

  it("uses the localhost web origin default without a wildcard", () => {
    const enableCors = vi.fn();
    configureApiCors({ enableCors }, {});

    expect(enableCors).toHaveBeenCalledWith(
      expect.objectContaining({ origin: expect.any(Function) }),
    );
    expect(enableCors).not.toHaveBeenCalledWith(
      expect.objectContaining({ origin: "*" }),
    );
  });

  it("handles a real preflight for the configured origin and rejects another origin", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      CorsTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    configureApiCors(app, { WEB_ORIGIN: "https://web.example.test" });
    await app.init();
    try {
      const allowed = await app.inject({
        method: "OPTIONS",
        url: "/v1/teams/example",
        headers: {
          origin: "https://web.example.test",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,x-correlation-id",
        },
      });
      expect(allowed.headers["access-control-allow-origin"]).toBe(
        "https://web.example.test",
      );
      expect(allowed.headers["access-control-allow-headers"]).toContain(
        "Content-Type",
      );

      const rejected = await app.inject({
        method: "OPTIONS",
        url: "/v1/teams/example",
        headers: {
          origin: "https://other.example.test",
          "access-control-request-method": "POST",
        },
      });
      expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
