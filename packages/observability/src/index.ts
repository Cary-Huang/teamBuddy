export interface CorrelationContext {
  correlationId: string;
  causationId?: string;
}

export interface AppLogger {
  info(message: string, context: CorrelationContext & Record<string, unknown>): void;
  error(message: string, context: CorrelationContext & Record<string, unknown>): void;
}
