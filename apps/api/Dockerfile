# Build stage
FROM node:22.23.4-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.14.4

# Copy package files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/formula-engine/package.json ./packages/formula-engine/
COPY packages/crdt/package.json ./packages/crdt/
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages ./packages
COPY apps/api ./apps/api

# Build packages
RUN pnpm --filter @jasheets/shared build
RUN pnpm --filter @jasheets/formula-engine build
RUN pnpm --filter @jasheets/crdt build

# Generate Prisma client
RUN cd apps/api && npx prisma generate

# Build the API
RUN pnpm --filter api build

# Self-contained node_modules: pnpm symlinks point into /app/node_modules/.pnpm, which the runner stage lacks.
# Keeps devDeps so the k8s initContainer can run `npx prisma migrate deploy`.
RUN pnpm --filter api deploy /out && cd /out && npx prisma generate

# Production stage
FROM node:22.23.4-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nestjs
RUN adduser --system --uid 1001 nestjs

# Copy built assets
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/apps/api/prisma ./prisma

USER nestjs

EXPOSE 4000

ENV PORT=4000

CMD ["node", "dist/src/main.js"]
