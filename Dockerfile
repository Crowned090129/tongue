# Pinned patch release so every build runs the same Node.
FROM node:20.20.2-alpine AS build
WORKDIR /app

# Exact dependency tree from package-lock.json, runtime dependencies only.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY --chown=node:node . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:20.20.2-alpine
WORKDIR /app
COPY --from=build --chown=node:node /app /app

# The server never writes to the filesystem at runtime (it only reads public/ and
# seed/), so it runs as the unprivileged "node" user that ships with the image.
USER node
EXPOSE 3001
CMD ["node", "--dns-result-order=ipv4first", "server.js"]
