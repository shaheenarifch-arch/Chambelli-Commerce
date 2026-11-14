# One image for the whole Chambelli stack. docker-compose.prod.yml runs it three times
# with different commands: the API, the admin dashboard and the CJ sync worker.
FROM node:22-alpine AS build
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm db:generate \
  && pnpm --filter @chambelli/api... build \
  && pnpm --filter @chambelli/worker... build \
  && pnpm --filter @chambelli/admin build

FROM node:22-alpine
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 8080 3001
CMD ["pnpm", "--filter", "@chambelli/api", "start"]
