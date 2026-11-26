# 0010 : réponses individuelles par Pub/Sub, commandes supprimées par le commit

- Statut : acceptée
- Date : 2026-11-26

## Contexte

Le coordinateur d'une partie applique les commandes que les nœuds ajoutent au stream `game:{id}:commands` (ADR 0002). Deux questions restaient ouvertes :
1. Comment faire parvenir au client concerné une réponse qui ne regarde que lui : un refus de `reduce` (`nickname_taken`, `too_late`...) ou l'acceptation d'un `join` ? Le coordinateur n'est pas forcément le nœud qui sert ce client.
2. Comment un nouveau coordinateur sait-il quelles commandes restent à appliquer ? Le plan initial mémorisait l'ID de la dernière commande traitée dans l'état.

## Décision

1. Chaque commande porte l'adresse de la connexion qui l'a reçue (`nodeId`, `connId`). Après le `commit`, le coordinateur publie la réponse sur `node:{nodeId}:replies`, un canal Pub/Sub propre à chaque nœud.
2. Le script `commit` supprime les commandes qu'il applique (`XTRIM MINID`), dans la même opération atomique que l'écriture de l'état et des événements. Le stream ne contient donc que des commandes en attente, et un coordinateur le lit toujours depuis le début.

## Raisons

- Le stream d'événements reste réservé aux événements de jeu, partagés et rejoués à la reconnexion. Une réponse individuelle n'a pas à y être conservée ni rejouée.
- Si le nœud destinataire a disparu, la réponse se perd sans conséquence : sa socket n'existe plus.
- Supprimer les commandes dans le `commit` donne la même garantie qu'un curseur (rien n'est perdu ni appliqué deux fois), sans clé supplémentaire ni enveloppe autour de l'état. `api` écrit un `GameState` nu.

## Conséquences

- Chaque nœud ouvre une connexion Redis de plus, dédiée à l'abonnement Pub/Sub.
- Même un lot de commandes sans effet (un `tick` sans changement, une commande refusée) passe par `commit`, pour être supprimé.
