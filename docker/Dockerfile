# Stage 1: Build
FROM node:24-bookworm AS build

WORKDIR /app

# Copy root package.json and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy workspace packages
COPY src/backend/package.json src/backend/
COPY src/frontend/package.json src/frontend/
COPY src/shared/package.json src/shared/
RUN npm ci

# Copy entire source tree
COPY . .

# Install type definitions for Playwright
RUN npm install -D @types/node playwright

# Build Vue frontend
RUN npx vite build --outDir dist/frontend

# Stage 2: Production
FROM node:24-bookworm-slim AS production

WORKDIR /app

# Copy only production dependencies
COPY --from=build /app/package.json ./
COPY --from=build /app/package-lock.json* ./
RUN npm ci --only=production

# Copy built frontend assets
COPY --from=build /app/dist/frontend ./dist/frontend

# Copy backend server
COPY --from=build /app/src/backend/src/ ./src/backend/src/

# Create non-root user
RUN addgroup --system --gid 1000 nodejs && \
    adduser --system --uid 1000 --ingroup nodejs appuser && \
    chown -R appuser:appuser /app && \
    chmod -R 755 /app

USER appuser

EXPOSE 3000

CMD ["node", "src/backend/src/server.ts"]
