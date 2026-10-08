# One image for every server process (API, worker, web, DB bootstrap). Built by deploy.sh.
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 CI=1
RUN npm install -g pnpm@10.28.0
WORKDIR /app

# Manifests first so the dependency layer is cached between deploys.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@hms/api..." --filter "@hms/web..." --filter hms

COPY . .
# The web server rewrites /api/v1 to this address (baked in at build time).
ENV API_INTERNAL_URL=http://api:4000
RUN pnpm turbo run build --filter=@hms/api... --filter=@hms/web... \
 && rm -rf apps/web/.next/cache

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
CMD ["node", "apps/api/dist/main.js"]
