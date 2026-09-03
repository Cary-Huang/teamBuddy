import { randomUUID } from "node:crypto";

import {
  recalculateScheduleRequestedV1Schema,
  type RecalculateScheduleRequestedV1,
} from "@teambuddy/contracts";

import type { DbTransaction } from "../database/client.js";
import type { OutboxRepository } from "./outbox.repository.js";

export interface MutationContext {
  correlationId: string;
}

export interface RecalculationOptions {
  horizonEndDate?: string;
}

export const appendPlanningRecalculation = async (
  tx: DbTransaction,
  outboxRepository: OutboxRepository,
  teamId: string,
  aggregateId: string,
  context: MutationContext,
  options: RecalculationOptions = {},
): Promise<RecalculateScheduleRequestedV1> => {
  const event = recalculateScheduleRequestedV1Schema.parse({
    type: "planning.recalculate.requested.v1",
    eventId: randomUUID(),
    correlationId: context.correlationId,
    teamId,
    requestedAt: new Date().toISOString(),
    ...(options.horizonEndDate
      ? { horizonEndDate: options.horizonEndDate }
      : {}),
  });

  await outboxRepository.append(tx, {
    eventId: event.eventId,
    type: event.type,
    correlationId: event.correlationId,
    aggregateId,
    payload: event,
    occurredAt: event.requestedAt,
  });
  return event;
};
