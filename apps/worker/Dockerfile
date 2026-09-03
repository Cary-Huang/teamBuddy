FROM node:22-alpine AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/scheduler/package.json packages/scheduler/package.json
RUN pnpm install --frozen-lockfile --filter @teambuddy/worker...

COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages/contracts packages/contracts
COPY packages/scheduler packages/scheduler
RUN pnpm --filter @teambuddy/contracts build \
  && pnpm --filter @teambuddy/scheduler build \
  && pnpm --filter @teambuddy/api build \
  && pnpm --filter @teambuddy/worker build \
  && pnpm deploy --legacy --filter @teambuddy/worker --prod /opt/worker

FROM node:22-alpine AS runtime

WORKDIR /app
RUN addgroup -S teambuddy && adduser -S teambuddy -G teambuddy
COPY --from=build /opt/worker ./
USER teambuddy

CMD ["node", "dist/bootstrap.js"]
