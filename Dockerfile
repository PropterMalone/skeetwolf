# Build stage — includes native build tools for better-sqlite3
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/feed/package.json packages/feed/
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage — slim, no build tools
FROM node:22-slim
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/shared/package.json /app/packages/shared/
COPY --from=build /app/packages/engine/package.json /app/packages/engine/
COPY --from=build /app/packages/feed/package.json /app/packages/feed/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=build /app/packages/feed/node_modules ./packages/feed/node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/feed/dist ./packages/feed/dist
CMD ["node", "packages/engine/dist/index.js"]
