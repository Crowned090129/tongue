# Pinned patch release so every build runs the same Node.
FROM node:20.20.2-alpine
WORKDIR /app

# Exact dependency tree from package-lock.json, runtime dependencies only.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

# The server never writes to the filesystem at runtime (it only reads public/ and
# seed/), so it runs as the unprivileged "node" user that ships with the image.
USER node
EXPOSE 3001
CMD ["node", "--dns-result-order=ipv4first", "server.js"]
