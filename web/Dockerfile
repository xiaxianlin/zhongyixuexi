# Build context must be the repo root (shares node_modules/tsconfig with the
# rest of the project):
#   docker build -f web/Dockerfile -t zhongyixuexi-web \
#     --build-arg VITE_API_BASE_URL=https://api.example.com .
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.webapp.json vite.web.config.ts ./
COPY web ./web
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run web:build

FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/out-web /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
