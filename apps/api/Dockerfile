# Image de production de l'API, construite depuis la racine du dépôt : docker build -f apps/api/Dockerfile .
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

# Ne garde que l'API et les packages dont elle dépend.
FROM base AS prune
COPY . .
RUN npx --yes turbo@2.11.13 prune @quorum/api --docker

# Le TypeScript est exécuté tel quel par Node (ADR 0004) : seules les dépendances de production sont installées.
FROM base AS install
COPY --from=prune /app/out/json/ .
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=prune /app/out/full/ .

FROM node:24-slim
ENV NODE_ENV=production
COPY --from=install /app /app
WORKDIR /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s CMD ["node", "-e", "fetch('http://localhost:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/main.ts"]
