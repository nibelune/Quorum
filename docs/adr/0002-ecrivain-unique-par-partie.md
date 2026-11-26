# 0002 : un écrivain unique par partie

- Statut : acceptée
- Date : 2026-11-26

## Contexte

Plusieurs nœuds reçoivent des commandes pour la même partie (réponses, actions de l'animateur). Il faut éviter les écritures concurrentes sur l'état, sans dupliquer la logique de jeu.

## Options envisagées

1. **Chaque nœud écrit, avec des scripts Lua atomiques** (vérification du délai et des doubles réponses dans Redis). C'est rapide, mais les règles du jeu sont alors dupliquées entre `game-engine` et Lua, et chaque nouvelle règle demande un nouveau script.
2. **Un coordinateur unique par partie**, qui reçoit les commandes via un stream Redis.

## Décision

Option 2. Les nœuds ajoutent les commandes à `game:{id}:commands`. Le coordinateur, qui détient un lease avec fencing token, les applique via `reduce`, puis écrit l'état et les événements dans un seul `commit` atomique.

## Conséquences

- Toute la logique reste dans `game-engine`. Le seul script Lua (`commit`) est générique.
- L'état mémorise la dernière commande traitée, donc la reprise par un autre coordinateur est exacte : rien n'est perdu ni appliqué deux fois.
- Le passage par Redis ajoute quelques millisecondes de latence. C'est négligeable pour un quiz, et l'accusé de réception est envoyé directement par le nœud qui reçoit la commande.
- Le débit d'une partie est limité par un seul nœud, ce qui reste très largement suffisant pour quelques milliers de joueurs.
