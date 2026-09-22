ARG APP_VERSION=unknown
ARG COMMIT_HASH=unknown

FROM node:26-bookworm AS frontend-build

ARG APP_VERSION
ARG COMMIT_HASH
ENV VITE_APP_VERSION=${APP_VERSION}
ENV VITE_COMMIT_HASH=${COMMIT_HASH}

WORKDIR /frontend

COPY src/frontend/package.json src/frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY src/frontend/ ./
RUN npm run build


FROM node:26-bookworm AS backend-build

WORKDIR /app

COPY src/backend/package.json src/backend/package-lock.json ./
RUN npm ci --omit=dev

COPY src/backend/src ./src
COPY src/backend/tsconfig.json src/backend/tsconfig.build.json ./

RUN npm ci && npm run build


FROM node:26-bookworm-slim AS production

ARG APP_VERSION
ARG COMMIT_HASH

WORKDIR /app

COPY --from=backend-build /app/package.json /app/package-lock.json ./
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /frontend/dist ./public

RUN chown -R node:node /app

USER node

EXPOSE 3000

ENV FRONTEND_DIST=./public
ENV APP_VERSION=${APP_VERSION}
ENV COMMIT_HASH=${COMMIT_HASH}

CMD ["node", "dist/src/server.js"]
