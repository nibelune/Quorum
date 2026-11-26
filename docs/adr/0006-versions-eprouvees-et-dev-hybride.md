# 0006 : versions éprouvées et environnement de dev hybride

- Statut : acceptée
- Date : 2026-11-26

## Contexte

Deux questions liées à l'environnement :
1. Faut-il suivre les dernières versions (Node 26, TypeScript 7, PostgreSQL 18) ou des versions plus anciennes mais rodées ?
2. Faut-il tout exécuter dans Docker, outillage compris, alors que le développement se fait sur macOS (avec OrbStack) et en grande partie avec Claude Code ?

## Décision

**Versions** : Node 24 LTS (au minimum 24.12), TypeScript 6, PostgreSQL 17, Redis 7.4. Pour les autres dépendances : la dernière version stable d'une majeure sortie depuis au moins 6 mois, jamais de pré-version.

**Environnement de dev** : ce qui tourne (apps, Postgres, Redis, Caddy) est dans Docker. L'outillage (install, typecheck, lint, tests, Claude Code et ses plugins) tourne sur l'hôte. Un seul `node_modules`, installé sur l'hôte avec les binaires natifs de macOS et de Linux (`supportedArchitectures`), est partagé avec les conteneurs par bind mount.

## Raisons

- Une version éprouvée a une documentation abondante, des bugs connus et contournés, et un écosystème qui la supporte. C'est aussi celle que l'agent connaît le mieux.
- TypeScript 7 est une réécriture complète du compilateur en Go. Le 6.0 est le dernier compilateur historique, mature et supporté par l'outillage. typescript-eslint, par exemple, accepte TypeScript jusqu'à 6.0 mais pas encore 7, et svelte-check ne prend en charge le 7 que derrière un flag.
- Node 24 reste maintenu jusqu'en 2028 et dispose du type stripping stable (ADR 0004).
- Lancer chaque commande d'outillage via `docker compose exec` ralentit la boucle de travail et complique l'usage de Claude Code et du plugin Svelte, qui s'appuient sur Node installé localement.
- L'exécution, elle, gagne à rester dans Docker : environnement identique à la prod, plusieurs nœuds `realtime` faciles à lancer, et `make up` suffit pour qu'un tiers fasse tourner le projet.

## Conséquences

- Node et pnpm doivent être installés sur l'hôte, aux versions de `.nvmrc` et `packageManager`.
- `pnpm install` ne se lance que sur l'hôte. Les images utilisent glibc (`-slim`), jamais musl (Alpine), pour que les binaires installés correspondent.
- Postgres et Redis exposent leurs ports en local pour les tests d'intégration.
- Deux façons de travailler coexistent (`pnpm` pour l'outillage, `make` pour l'exécution), documentées dans le CLAUDE.md.
- Une montée de version (Node 26, TypeScript 7...) fera l'objet d'un nouvel ADR.
