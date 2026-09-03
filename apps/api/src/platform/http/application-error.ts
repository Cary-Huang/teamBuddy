export class ApplicationError extends Error {
  readonly name = "ApplicationError";

  constructor(
    readonly code: string,
    message: string,
    readonly status: 404 | 422,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (code: string, message: string) =>
  new ApplicationError(code, message, 404);

export const domainConflict = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => new ApplicationError(code, message, 422, details);
