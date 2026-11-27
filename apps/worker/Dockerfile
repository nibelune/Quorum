# Image de production du worker, construite depuis la racine du dépôt : docker build -f apps/worker/Dockerfile .
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

# Ne garde que le worker et les packages dont il dépend.
FROM base AS prune
COPY . .
RUN npx --yes turbo@2.11.13 prune @quorum/worker --docker

# Le TypeScript est exécuté tel quel par Node (ADR 0004) : seules les dépendances de production sont installées.
FROM base AS install
COPY --from=prune /app/out/json/ .
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=prune /app/out/full/ .

# Pas de port ni de HEALTHCHECK : le worker ne sert rien, il exécute les tâches de la file. S'il s'arrête, il est redémarré.
FROM node:24-slim
ENV NODE_ENV=production
COPY --from=install /app /app
WORKDIR /app/apps/worker
USER node
CMD ["node", "src/main.ts"]
