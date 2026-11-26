# 0005 : Fastify pour l'API HTTP

- Statut : acceptée
- Date : 2026-11-26

## Contexte

L'API couvre l'authentification des animateurs, le CRUD des quiz, la création des parties et la facturation. Options envisagées : Hono, Fastify, NestJS, Express, routes serveur de SvelteKit.

## Décision

Fastify, avec `fastify-type-provider-zod`. Les schémas des requêtes et des réponses sont dans `packages/protocol` et partagés avec le front, qui les utilise via un petit wrapper `fetch` typé.

## Raisons

- C'est le framework HTTP le plus mature et le plus performant sur Node, avec un bon écosystème de plugins.
- Les routes sont typées par zod, et les tests passent par `app.inject()` sans démarrer de serveur.
- NestJS est trop lourd pour une API modeste, et ses décorateurs se marient mal avec un TypeScript strict à syntaxe effaçable (ADR 0004). Express a un typage faible.
- Une API séparée de SvelteKit clarifie les responsabilités et sert aussi au worker.

## Conséquences

Pas de génération de client OpenAPI : dans un monorepo TypeScript, partager les schémas zod suffit. Une doc OpenAPI pourra être ajoutée plus tard si l'API devient publique.
