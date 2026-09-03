import { randomUUID } from "node:crypto";

export interface CorrelatedRequest {
  headers: Record<string, string | string[] | undefined>;
  correlationId?: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const getCorrelationId = (request: CorrelatedRequest): string => {
  if (request.correlationId) return request.correlationId;

  const raw = request.headers["x-correlation-id"];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const correlationId =
    typeof candidate === "string" && uuidPattern.test(candidate)
      ? candidate
      : randomUUID();
  request.correlationId = correlationId;
  return correlationId;
};
