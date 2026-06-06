# ---- Shared deps stage ----
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

# ---- Dev target (used by compose for migrate + app) ----
FROM deps AS dev
WORKDIR /app
COPY . .
RUN mkdir -p /app/data
EXPOSE 3003
CMD ["bun", "--hot", "run", "server/index.ts"]

# ---- Build stage (produces client static assets in dist/public/) ----
FROM deps AS build
WORKDIR /app
COPY . .
RUN bun run build

# ---- Prod runtime ----
FROM oven/bun:1-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock* bun.lockb* ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY shared ./shared
COPY server ./server
COPY migrations ./migrations
COPY drizzle.config.ts tsconfig.json ./
RUN mkdir -p /app/data && chown -R bun:bun /app/data
EXPOSE 3003
USER bun
CMD ["bun", "run", "server/index.ts"]
