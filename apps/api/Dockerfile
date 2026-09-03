FROM node:22-alpine AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile --filter @teambuddy/api...

COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm --filter @teambuddy/contracts build \
  && pnpm --filter @teambuddy/api build \
  && pnpm deploy --legacy --filter @teambuddy/api --prod /opt/api

FROM node:22-alpine AS runtime

WORKDIR /app
RUN addgroup -S teambuddy && adduser -S teambuddy -G teambuddy
COPY --from=build /opt/api ./
COPY --from=build /workspace/apps/api/src/platform/database/migrations ./dist/platform/database/migrations
USER teambuddy

EXPOSE 3001
CMD ["sh", "-c", "node dist/platform/database/initialize.js && node dist/bootstrap.js"]
