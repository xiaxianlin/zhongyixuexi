# Build context must be the repo root (server/ alone doesn't have package.json
# or the shared tsconfig*.json files it needs):
#   docker build -f server/Dockerfile -t zhongyixuexi-server .
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.server.json tsconfig.server.build.json ./
COPY server ./server
RUN npx tsc -p tsconfig.server.build.json

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/out-server ./out-server
EXPOSE 4000
CMD ["node", "out-server/src/index.js"]
