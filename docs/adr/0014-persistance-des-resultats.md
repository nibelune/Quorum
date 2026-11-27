# 0014 : persistance des résultats par le worker

- Statut : acceptée
- Date : 2026-11-27

## Contexte

Une partie vit dans Redis, qui l'efface 2 h après sa dernière commande (ADR 0003). Les statistiques de la phase 3 demandent de garder ses résultats dans Postgres. Deux obstacles :

- l'état ne garde que les réponses de la question en cours : celles des questions précédentes n'y sont plus ;
- le stream des événements est plafonné à environ 1000 entrées : avec quelques centaines de joueurs, les premières fins de question en sortent avant la fin de la partie.

## Décision

- **La partie existe en base dès son lancement.** L'API crée une ligne `games` (propriétaire, quiz, titre, mode, questions telles qu'elles seront jouées, choix mélangés) avant d'écrire l'état initial dans Redis.
- **Chaque fin de question est archivée.** L'événement `question_ended` porte, pour chaque équipe, son choix, son temps de réponse et ses points. Le coordinateur le recopie dans la liste `game:{id}:rounds`, dans le même `commit` atomique que l'état : le script Lua reste générique (il archive les entrées qu'on lui passe), et l'état ne grossit pas au fil de la partie.
- **La fin de partie déclenche une tâche BullMQ.** Au `game_ended`, le coordinateur ajoute la tâche `persist-game` à la file `jobs`, avec l'identifiant de la partie comme identifiant de tâche : BullMQ ignore un doublon. Un nœud qui reprend une partie terminée l'ajoute à nouveau, au cas où le coordinateur précédent serait tombé entre le commit et l'ajout. realtime ne parle toujours qu'à Redis.
- **Le worker copie les résultats dans Postgres**, en une transaction : la date de fin (celle de l'ajout de la tâche), les équipes et leur score, les joueurs, une réponse par question et par équipe. La tâche peut être rejouée : les résultats déjà écrits sont remplacés. Elle est retentée 5 fois, avec un délai croissant.
- BullMQ 5 : la version 6 a moins de 6 mois (ADR 0006).

## Conséquences

- Les statistiques se calculent en SQL sur `game_teams`, `game_players` et `game_answers`. Une réponse se réfère à la question par son identifiant, et au choix par sa position dans les questions jouées (`games.questions`).
- Une partie jamais terminée (l'animateur ferme son écran) n'a pas de résultats : elle reste en base sans date de fin.
- Reste un cas non couvert : le coordinateur tombe entre le commit de la fin de partie et l'ajout de la tâche, et plus personne ne se reconnecte à la partie. Ses résultats sont alors perdus.
- Le worker est un service de plus, en dev (Compose) comme en production (Railway). Il n'expose aucun port.
