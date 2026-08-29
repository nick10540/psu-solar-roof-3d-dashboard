# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: compile the Vite/React SPA to static assets.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Dependencies first so this layer is cached until package*.json changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Serve stage: nginx serves the built SPA and reverse-proxies /api/solaredge to
# the backend container (Dockerfile.worker), which holds the SolarEdge API
# key. Building data still lives in localStorage - see
# buildingStorageService.ts. See docker/nginx.conf and docker-compose.yml.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS serve

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3001

CMD ["nginx", "-g", "daemon off;"]
