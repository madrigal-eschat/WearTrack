ARG CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX
FROM ${CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX}/library/node:24-bookworm AS frontend-build

WORKDIR /frontend

COPY src/frontend/package.json src/frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY src/frontend/ ./
RUN npm run build


ARG CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX
FROM ${CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX}/library/node:24-bookworm AS backend-build

WORKDIR /app

COPY src/backend/package.json src/backend/package-lock.json ./
RUN npm ci --omit=dev

COPY src/backend/src ./src
COPY src/backend/tsconfig.json ./

RUN npm ci && npm run build


ARG CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX
FROM ${CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX}/library/node:24-bookworm-slim AS production

WORKDIR /app

COPY --from=backend-build /app/package.json /app/package-lock.json ./
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /frontend/dist ./public

RUN chown -R node:node /app

USER node

EXPOSE 3000

ENV FRONTEND_DIST=./public

CMD ["node", "dist/src/server.js"]
