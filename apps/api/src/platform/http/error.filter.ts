import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { ApiErrorResponse } from "@teambuddy/contracts";

import { OutboxEventConflictError } from "../outbox/outbox.repository.js";
import { ApplicationError } from "./application-error.js";
import { getCorrelationId, type CorrelatedRequest } from "./correlation-id.js";

interface HttpReply {
  status(code: number): { send(payload: unknown): void };
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<CorrelatedRequest>();
    const reply = http.getResponse<HttpReply>();
    const correlationId = getCorrelationId(request);
    const mapped = mapException(exception);

    reply.status(mapped.status).send({ ...mapped.body, correlationId });
  }
}

const mapException = (
  exception: unknown,
): { status: number; body: Omit<ApiErrorResponse, "correlationId"> } => {
  if (exception instanceof ApplicationError) {
    return {
      status: exception.status,
      body: {
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      },
    };
  }

  if (exception instanceof OutboxEventConflictError) {
    return {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      body: { code: exception.code, message: exception.message },
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return {
        status,
        body: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      };
    }
    const response = exception.getResponse();
    const value = typeof response === "object" ? response : {};
    const code = readString(value, "code") ?? httpCode(status);
    const message =
      readString(value, "message") ??
      (typeof response === "string" ? response : exception.message);
    const details = readRecord(value, "details");
    return {
      status,
      body: { code, message, ...(details ? { details } : {}) },
    };
  }

  if (isPostgresConflict(exception)) {
    return {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      body: {
        code: "DOMAIN_CONFLICT",
        message: "The requested change conflicts with existing data",
      },
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  };
};

const readString = (value: object, key: string): string | undefined => {
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
};

const readRecord = (
  value: object,
  key: string,
): Record<string, unknown> | undefined => {
  const candidate = (value as Record<string, unknown>)[key];
  return candidate !== null &&
    typeof candidate === "object" &&
    !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : undefined;
};

const isPostgresConflict = (exception: unknown): boolean =>
  exception !== null &&
  typeof exception === "object" &&
  ["23503", "23505", "23514"].includes(
    String(
      (exception as { cause?: { code?: unknown }; code?: unknown }).cause
        ?.code ?? (exception as { code?: unknown }).code,
    ),
  );

const httpCode = (status: number): string => {
  if (status === HttpStatus.BAD_REQUEST) return "VALIDATION_ERROR";
  if (status === HttpStatus.NOT_FOUND) return "NOT_FOUND";
  if (status === HttpStatus.UNPROCESSABLE_ENTITY) return "DOMAIN_CONFLICT";
  return "HTTP_ERROR";
};
