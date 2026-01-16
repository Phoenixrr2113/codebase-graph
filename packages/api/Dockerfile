# Build stage
FROM node:22-slim AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY turbo.json tsconfig.base.json ./
COPY packages/types ./packages/types
COPY packages/parser ./packages/parser
COPY packages/graph ./packages/graph
COPY packages/api ./packages/api

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build packages
RUN pnpm --filter @codegraph/api build

# Production stage
FROM node:22-slim AS runner
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/types/package.json ./packages/types/package.json
COPY --from=builder /app/packages/parser/dist ./packages/parser/dist
COPY --from=builder /app/packages/parser/package.json ./packages/parser/package.json
COPY --from=builder /app/packages/graph/dist ./packages/graph/dist
COPY --from=builder /app/packages/graph/package.json ./packages/graph/package.json
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/api/package.json ./packages/api/package.json
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

EXPOSE 3001

CMD ["node", "packages/api/dist/index.js"]
