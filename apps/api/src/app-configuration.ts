export const DEFAULT_WEB_ORIGIN = "http://localhost:3000";

const normalizeWebOrigins = (webOrigin: string): string[] =>
  webOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

export interface CorsConfigurableApplication {
  enableCors(options: {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allowed: boolean) => void,
    ) => void;
    methods: string[];
    allowedHeaders: string[];
    credentials: false;
  }): void;
}

export const createCorsOptions = (webOrigin = DEFAULT_WEB_ORIGIN) => {
  const allowedOrigins = new Set(normalizeWebOrigins(webOrigin));

  return {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allowed: boolean) => void,
    ): void => callback(null, Boolean(origin && allowedOrigins.has(origin))),
    methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Correlation-Id", "Accept"],
    credentials: false as const,
  };
};

export const configureApiCors = (
  app: CorsConfigurableApplication,
  environment: { WEB_ORIGIN?: string } = process.env,
): void => {
  app.enableCors(createCorsOptions(environment.WEB_ORIGIN));
};
