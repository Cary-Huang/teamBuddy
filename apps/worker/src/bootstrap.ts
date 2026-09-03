import { randomUUID } from "node:crypto";

import { createBackendApplicationPorts } from "@teambuddy/api/backend";

import { createWorkerDatabase, readWorkerDatabaseUrl } from "./database.js";
import { RecalculateScheduleV1Handler } from "./handlers/recalculate-schedule-v1.js";
import {
  OutboxPoller,
  type ClaimedOutboxEvent,
  type WorkerLogger,
} from "./outbox-poller.js";

const POLL_INTERVAL_MS = 1_000;

const logger: WorkerLogger = {
  info: (message, context) => console.info(message, context),
  error: (message, context) => console.error(message, context),
  warn: (message, context) => console.warn(message, context),
};

export interface PollingRunner {
  start(): void;
  shutdown(): Promise<void>;
}

export interface WorkerLifecycle {
  shutdown(): Promise<void>;
}

export const createWorkerLifecycle = (
  runner: PollingRunner,
  close: readonly (() => Promise<void>)[],
  lifecycleLogger: Pick<WorkerLogger, "error">,
  workerId: string,
): WorkerLifecycle => {
  let shutdownPromise: Promise<void> | undefined;
  return {
    shutdown: () => {
      shutdownPromise ??= (async () => {
        try {
          await runner.shutdown();
        } catch (error) {
          lifecycleLogger.error("Worker polling shutdown failed", {
            workerId,
            error: serializeError(error),
          });
        }
        await Promise.all(
          close.map(async (closeResource) => {
            try {
              await closeResource();
            } catch (error) {
              lifecycleLogger.error("Worker resource shutdown failed", {
                workerId,
                error: serializeError(error),
              });
            }
          }),
        );
      })();
      return shutdownPromise;
    },
  };
};

export const createPollingRunner = (
  poll: () => Promise<void>,
  intervalMs = POLL_INTERVAL_MS,
): PollingRunner => {
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;
  const run = () => {
    if (stopping || inFlight) return;
    inFlight = poll()
      .catch(() => undefined)
      .finally(() => {
        inFlight = undefined;
        if (!stopping) timer = setTimeout(run, intervalMs);
      });
  };
  return {
    start: run,
    shutdown: async () => {
      stopping = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
};

const bootstrap = async (): Promise<void> => {
  const databaseUrl = readWorkerDatabaseUrl();
  const database = createWorkerDatabase(databaseUrl);
  const backend = createBackendApplicationPorts(databaseUrl);
  const recalculationHandler = new RecalculateScheduleV1Handler(backend);
  const workerId = process.env.WORKER_ID ?? randomUUID();
  const poller = new OutboxPoller(
    database.sql,
    (event) => dispatch(event, recalculationHandler),
    logger,
    workerId,
  );
  const poll = async () => {
    try {
      const count = await poller.processOnce();
      if (count > 0) logger.info("Outbox poll completed", { workerId, count });
    } catch (error) {
      logger.error("Outbox poll failed", {
        workerId,
        error: serializeError(error),
      });
    }
  };
  const runner = createPollingRunner(poll);
  runner.start();

  const lifecycle = createWorkerLifecycle(
    runner,
    [backend.close, database.close],
    logger,
    workerId,
  );
  process.once("SIGINT", () => void lifecycle.shutdown());
  process.once("SIGTERM", () => void lifecycle.shutdown());

  logger.info("TeamBuddy worker started", { workerId });
};

const dispatch = async (
  event: ClaimedOutboxEvent,
  handler: RecalculateScheduleV1Handler,
): Promise<void> => {
  if (event.type === "planning.recalculate.requested.v1") {
    await handler.handle(event.payload);
    return;
  }
  throw new UnsupportedOutboxEventError(event.type);
};

const serializeError = (error: unknown): Record<string, string> =>
  error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };

class UnsupportedOutboxEventError extends Error {
  readonly name = "UnsupportedOutboxEventError";

  constructor(type: string) {
    super(`Unsupported outbox event type: ${type}`);
  }
}

if (require.main === module) {
  void bootstrap().catch((error) =>
    logger.error("TeamBuddy worker failed to start", {
      error: serializeError(error),
    }),
  );
}
