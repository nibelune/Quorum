# 0001 : `ws` plutôt que Socket.IO

- Statut : acceptée
- Date : 2026-11-26

## Contexte

Le projet a pour but de démontrer la maîtrise du temps réel sur plusieurs serveurs. Socket.IO fournit déjà les rooms, la reconnexion, un adaptateur Redis et une récupération de l'état de connexion.

## Décision

Utiliser la librairie `ws` (WebSocket standard) et écrire nous-mêmes la synchronisation entre nœuds.

## Raisons

- La reprise après coupure de Socket.IO ne connaît rien de la partie. Il nous faut de toute façon une séquence par partie, liée à l'état dans Redis, qui survive à un changement de coordinateur.
- Socket.IO ajoute son propre protocole par-dessus WebSocket : le client doit utiliser `socket.io-client`, les tests de charge k6 se compliquent et l'app joueur s'alourdit.
- Son repli en long-polling impose des sticky sessions, contraires à ADR 0003.
- Avec l'adaptateur Redis, le cœur du sujet se réduirait à de la configuration.

## Conséquences

À écrire et tester nous-mêmes : heartbeats, reconnexion côté client, rooms locales (`Map<GameId, Set<WebSocket>>`), validation des messages. Cela représente quelques centaines de lignes.
