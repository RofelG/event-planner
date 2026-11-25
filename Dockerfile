# syntax=docker/dockerfile:1

# Build stage: needs devDependencies (Vite, Tailwind, Sass) to build the client.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.mjs tailwind.config.cjs ./
COPY client ./client
RUN npm run build

# Runtime stage: production dependencies only, so the image stays small.
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist

# The official image ships a non-root "node" user; never run the API as root.
USER node
EXPOSE 3001

# Slim images have no curl, so probe the health endpoint with Node itself.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.API_PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
