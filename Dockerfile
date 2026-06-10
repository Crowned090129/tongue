FROM node:20-alpine

RUN addgroup -S tonge && adduser -S tonge -G tonge

WORKDIR /app

COPY package*.json ./
RUN npm install --production --no-audit --no-fund

COPY --chown=tonge:tonge . .
RUN rm -f .env data/*.db

USER tonge
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "server.js"]
