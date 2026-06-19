# Build from the repository root:
#   docker build -f apps/server/Dockerfile -t buddy-server .
# The image mirrors the repo layout (/app/apps/server + /app/sample-docs) so the
# relative source paths in buddy.config.yaml resolve the same as in development.
# syntax=docker/dockerfile:1

# ---- build stage ----
FROM node:22-slim AS build
WORKDIR /app/apps/server
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci

COPY apps/server/prisma ./prisma
RUN npx prisma generate

COPY apps/server/tsconfig.json ./
COPY apps/server/src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/server
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/apps/server/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY apps/server/package.json ./
COPY apps/server/prisma ./prisma
COPY apps/server/buddy.config.yaml ./
# Demo docs at the repo-root layout so ../../sample-docs resolves inside the image.
COPY sample-docs /app/sample-docs

EXPOSE 3000

# Apply migrations, then start (server also seed-indexes configured sources on boot).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
