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
# Serve stage: the dashboard is a fully client-side SPA (SolarEdge is called
# straight from the browser, building data lives in localStorage - see
# src/services/solarEdgeService.ts and buildingStorageService.ts), so a
# static file server is all production needs. No Node/Express runtime.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS serve

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3001

CMD ["nginx", "-g", "daemon off;"]
