# Image de production du web, construite depuis la racine du dépôt : docker build -f apps/web/Dockerfile .
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

# Ne garde que le web et les packages dont il dépend.
FROM base AS prune
COPY . .
RUN npx --yes turbo@2.11.13 prune @quorum/web --docker

# La compilation (Vite) a besoin des dépendances de développement.
FROM base AS build
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=prune /app/out/full/ .
RUN pnpm -F @quorum/web build

FROM base AS install
COPY --from=prune /app/out/json/ .
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=prune /app/out/full/ .

# Serveur adapter-node : il sert la coquille de l'application, rendue côté client (ADR 0011).
FROM node:24-slim
ENV NODE_ENV=production HOST=:: PORT=3000
COPY --from=install /app /app
COPY --from=build /app/apps/web/build /app/apps/web/build
WORKDIR /app/apps/web
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s CMD ["node", "-e", "fetch('http://localhost:3000/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "build"]
