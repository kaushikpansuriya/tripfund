# Build context: repository root (see docker-compose.yml)
FROM node:24-alpine
WORKDIR /app

# The calculation engine has no dependencies; the API imports it directly.
COPY packages/engine ./packages/engine
COPY server/package.json ./server/
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY server ./server

WORKDIR /app/server
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
USER node
# Node 24 runs TypeScript directly (type stripping), so there is no build step.
CMD ["node", "src/index.ts"]
