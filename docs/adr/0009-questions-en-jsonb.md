# 0009 : les questions d'un quiz stockées en jsonb

- Statut : acceptée
- Date : 2026-11-26

## Contexte

Un quiz contient une liste ordonnée de questions. Postgres permet deux modèles : une table `questions`, avec une ligne et une position par question, ou une colonne `jsonb` dans la table `quizzes`.

## Décision

Les questions sont stockées dans une colonne `questions jsonb` de la table `quizzes`, au format du schéma `Question` de `packages/protocol`.

## Raisons

- Un quiz est toujours lu et enregistré en entier : l'éditeur sauvegarde le quiz complet, et la création d'une partie le copie dans Redis. Aucune requête ne porte sur une question isolée.
- Enregistrer un quiz se fait en un seul `UPDATE`, sans position à maintenir ni transaction qui supprime puis réinsère les questions.
- Le format est déjà défini par le schéma zod `Question`. L'API valide le quiz à l'entrée, et la base le stocke tel quel.

## Conséquences

- La base ne vérifie pas la structure des questions : c'est la validation zod de l'API qui la garantit.
- Chaque question garde un `id` stable d'une sauvegarde à l'autre. Les statistiques de la phase 3 s'y référeront sans clé étrangère, ce qui convient : une partie jouée garde ses résultats même si le quiz est modifié ensuite.
- Si un besoin de requête par question apparaît (une bibliothèque de questions, par exemple), une migration pourra les extraire dans une table.
