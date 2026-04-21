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
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
