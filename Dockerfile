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
#
# This is also where HTTP Basic auth is enforced, for the whole origin at once:
# 25-basic-auth.sh turns the compose environment into an .htpasswd at start-up
# and docker/nginx.conf includes it at server level.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS serve

# htpasswd, to hash the Basic auth password handed in at container start. Not
# in the nginx image, and ~1 MB installed.
RUN apk add --no-cache apache2-utils

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Runs from nginx's own entrypoint before the server starts. Both fixups are
# load-bearing on a Windows checkout: git's autocrlf rewrites the script to
# CRLF (see .gitattributes) and COPY carries no exec bit, and either one alone
# makes the entrypoint skip the file - silently, in the exec-bit case, which
# would leave nginx starting with no auth-basic.conf to include.
COPY docker/docker-entrypoint.d/25-basic-auth.sh /docker-entrypoint.d/25-basic-auth.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/25-basic-auth.sh \
    && chmod +x /docker-entrypoint.d/25-basic-auth.sh

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3001

CMD ["nginx", "-g", "daemon off;"]
