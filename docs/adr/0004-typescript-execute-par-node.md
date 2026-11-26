# 0004 : TypeScript exécuté directement par Node, sans build

- Statut : acceptée
- Date : 2026-11-26

## Contexte

Les apps Node (`api`, `realtime`, `worker`) et les packages internes sont en TypeScript. Il existe plusieurs façons de les exécuter : tsc ou tsup suivis de node, tsx, ou le type stripping natif de Node.

## Décision

Node exécute directement les fichiers `.ts` grâce au type stripping. Il est actif par défaut depuis Node 22.18 et stable depuis Node 24.12, d'où la version minimale imposée (ADR 0006). Les packages internes exposent leurs sources (`"exports": { ".": "./src/index.ts" }`). `tsc --noEmit` assure uniquement la vérification des types, en local et en CI.

## Raisons

- Aucune étape de build, aucun source map, aucun outil supplémentaire : la configuration la plus simple possible.
- Le code exécuté est exactement le code écrit.

## Conséquences

- Seule la syntaxe effaçable est autorisée (`erasableSyntaxOnly`) : pas d'`enum`, de `namespace` ni de parameter properties.
- Les imports relatifs portent l'extension `.ts`, et les imports de types utilisent `import type` (`verbatimModuleSyntax`).
- Node refuse d'exécuter le TypeScript situé sous `node_modules`. Les liens symboliques du workspace pnpm pointent vers `packages/`, donc tout fonctionne (vérifié). En revanche, `pnpm deploy`, qui copie les packages dans `node_modules`, ne doit pas être utilisé.
- SvelteKit garde sa propre chaîne (Vite) et consomme les mêmes sources.
