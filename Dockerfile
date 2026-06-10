FROM node:20-alpine

# Security: run as non-root user
RUN addgroup -S tonge && adduser -S tonge -G tonge

WORKDIR /app

# Install deps first (layer-cached unless package.json changes)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY --chown=tonge:tonge . .

# Remove things that must not be in the image
RUN rm -f .env data/*.db

USER tonge
EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]
