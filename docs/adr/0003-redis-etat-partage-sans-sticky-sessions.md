# 0003 : état des parties dans Redis, sans sticky sessions

- Statut : acceptée
- Date : 2026-11-26

## Contexte

Un joueur doit pouvoir se reconnecter sur n'importe quel nœud (changement de réseau, redémarrage d'un nœud, déploiement), et un nœud doit pouvoir tomber sans interrompre une partie.

## Décision

L'état des parties en cours vit dans Redis : état, streams de commandes et d'événements, lease. Les nœuds `realtime` ne gardent en mémoire que leurs sockets. Caddy répartit les connexions sans affinité.

## Raisons

- Avec des sticky sessions, la panne d'un nœud ferait perdre l'état des parties qu'il héberge.
- Les Redis Streams fournissent à la fois la diffusion entre nœuds et le rejeu à la reconnexion, avec un seul mécanisme.

## Conséquences

- Redis devient un point unique de défaillance, assumé pour ce projet.
- Chaque lecture de l'état depuis Redis est validée par zod.
- Les parties terminées sont copiées dans Postgres par le worker (phase 3) ; Redis ne garde que le temps réel, avec un TTL.
