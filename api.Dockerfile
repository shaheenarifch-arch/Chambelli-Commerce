FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm build
CMD ["pnpm","--filter","@chambelli/api","start"]
