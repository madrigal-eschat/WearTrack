FROM node:24-bookworm AS build

WORKDIR /app

COPY src/backend/package.json src/backend/package-lock.json ./
RUN npm ci

COPY src/backend/src ./src
COPY src/backend/tsconfig.json ./

RUN npm run build

FROM node:24-bookworm-slim AS production

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

RUN addgroup --system --gid 1000 nodejs \
    && adduser --system --uid 1000 --ingroup nodejs appuser \
    && chown -R appuser:appuser /app \
    && chmod -R 755 /app

USER appuser

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
