import { BadRequestException, type PipeTransform } from "@nestjs/common";

interface ValidationIssue {
  code: string;
  message: string;
  path: PropertyKey[];
}

interface PublicSchema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: ValidationIssue[] } };
}

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: PublicSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: {
        issues: result.error.issues.map(({ code, message, path }) => ({
          code,
          message,
          path,
        })),
      },
    });
  }
}
