# Architecture de Quorum

Ce document décrit le *comment*. Le *pourquoi* des choix est dans `docs/adr/`.

## Vue d'ensemble

```
   Téléphones des joueurs / écran projeté / dashboard
                        │ HTTPS + WebSocket
                   ┌────┴────┐
                   │  Caddy  │   seul point d'entrée, pas de sticky sessions
                   └────┬────┘
        ┌───────────────┼──────────────────┐
       web             api            realtime × N
    (SvelteKit)     (Fastify)       (ws, sans état local durable)
                        │                  │
                     Postgres            Redis
              (comptes, quiz, résultats)  (parties en cours)
```

- **api** gère les comptes, les quiz et la création des parties. Il écrit l'état initial d'une partie dans Redis et délivre les jetons animateur.
- **realtime** gère tout le reste du cycle de vie d'une partie. Il ne parle qu'à Redis, jamais à Postgres.

## Déroulé d'une partie

Phases : `lobby` -> `question` -> `reveal` -> `leaderboard` -> (question suivante ou) `ended`

- Une question a un énoncé (300 caractères max), 2 à 4 choix (120 caractères max), une seule bonne réponse et une durée de 5 à 300 s. Une question vrai/faux est un QCM à deux choix.
- L'animateur crée une partie depuis le dashboard et choisit le mode : `solo` ou `teams`. Un PIN à 6 chiffres et un QR code s'affichent sur l'écran projeté.
- Les joueurs rejoignent avec un pseudo (1 à 20 caractères, unique dans la partie).
- Pendant `question`, chaque joueur répond une seule fois. Une réponse compte si elle est reçue avant `deadline + GRACE_MS` (250 ms de tolérance réseau).
- Pendant `reveal`, on affiche la bonne réponse et la répartition des votes. La bonne réponse n'est **jamais** envoyée avant.
- Pendant `leaderboard`, on affiche les 10 premiers ; chaque joueur voit aussi son rang sur son téléphone.
- `ended` affiche le podium : les 5 premiers, qui restent à l'écran.

**Score** d'une réponse correcte : `round(1000 * (1 - (tempsDeReponse / dureeQuestion) / 2))`, soit entre 500 et 1000. Réponse fausse, tardive ou absente : 0. Le temps de réponse est mesuré à la réception par le serveur.

### Mode équipes (ADR 0007)

Pensé pour les soirées en bar : une équipe par table, qui discute avant de répondre.

- En rejoignant, le joueur crée une équipe (nom de 1 à 24 caractères, unique dans la partie) ou rejoint une équipe existante. Il ne peut plus en changer ensuite. Après le lancement de la partie, on ne peut plus créer d'équipe, seulement en rejoindre une.
- Le créateur de l'équipe en est le **capitaine**. Lui seul envoie la réponse de l'équipe ; une réponse envoyée par un autre membre est refusée (`not_captain`).
- Dès que le capitaine a répondu, ses coéquipiers voient son choix sur leur téléphone (`team_answer_locked`). Les autres équipes ne le voient pas.
- Si le capitaine quitte la partie ou en est exclu, le membre arrivé le plus tôt devient capitaine (`captain_changed`). Une équipe vide disparaît.
- Le score se calcule comme en solo, sur la réponse et le temps de réponse du capitaine, et il est attribué à l'équipe. Le classement et le podium sont ceux des équipes.
- Une table avec un seul téléphone forme simplement une équipe d'un membre.

**Accessibilité** : chaque choix de réponse est identifié par une forme et une couleur, jamais par la couleur seule. Les animations respectent `prefers-reduced-motion`.

## Game engine (`packages/game-engine`)

Toute la logique de jeu, sans I/O ni horloge :

```ts
reduce(state: GameState, command: Command):
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: GameError }

project(event: GameEvent, to: Recipient): ServerMessage | null   // ce que ce destinataire a le droit de voir
snapshot(state: GameState, to: Recipient): ServerMessage          // vue complète pour une reprise
```

Chaque commande porte `at` (horodatage de réception). `project` et `snapshot` garantissent qu'un joueur ne reçoit que ce qui le concerne. C'est là que la bonne réponse est masquée avant `reveal`, et que le choix d'un capitaine n'est montré qu'à son équipe.

`Recipient` vaut `{ role: "host" }`, `{ role: "player", playerId, teamId? }` ou `{ role: "visitor" }` (un joueur qui a saisi le PIN mais n'a pas encore rejoint la partie).

## Protocole (`packages/protocol`)

Messages JSON validés par zod, union discriminée sur `type`. Taille maximale : 4 Kio.

**Client -> serveur**
- Tous : `hello { protocolVersion, token?, lastSeq? }` (premier message de chaque connexion), `ping { t }`
- Joueur : `lookup { pin }` (avant de rejoindre : récupère le mode et la liste des équipes), `join { pin, nickname, team? }` avec `team` = `{ create: name }` ou `{ join: teamId }` en mode équipes, `answer { questionId, choiceIndex }`
- Animateur : `start`, `next`, `kick { playerId }`, `end`

**Serveur -> client**
- Issus du flux d'événements, avec `seq` : `player_joined`, `player_left`, `team_created`, `captain_changed`, `question_started { questionId, text, choices, deadline }`, `team_answer_locked { choiceIndex }` (équipe concernée uniquement), `answer_count` (animateur), `question_ended { correctIndex, distribution, you? }`, `leaderboard { top, you? }`, `game_ended { podium }`. En mode équipes, `you`, `top` et `podium` portent sur les équipes.
- Locaux au nœud, sans `seq` : `game_info { mode, teams? }` (réponse à `lookup`), `welcome { playerId, teamId?, token }` (réponse à `join`), `snapshot { seq, view }`, `answer_received`, `pong { t, serverTime }`, `error { code }`, `reload`

Si `protocolVersion` ne correspond pas, le serveur répond `reload` : le client recharge la page. Ça évite les incohérences après un déploiement.

## Identité et sécurité

- **Joueur** : au `join`, le nœud génère un `playerId` et un jeton HMAC (`node:crypto`) contenant `{ gameId, playerId, teamId?, role: "player" }`. L'équipe étant fixée au `join`, elle peut figurer dans le jeton. Le client le garde en `sessionStorage` et le renvoie dans `hello` à chaque reconnexion.
- **Animateur** : l'écran `/host/[gameId]` demande à l'API un jeton `role: "host"`, à courte durée de vie (`POST /games/:id/host-token`, authentifié par la session Better Auth et réservé au propriétaire de la partie). `realtime` vérifie seulement la signature, sans accès à la base.
- Secret HMAC partagé entre `api` et `realtime` via la variable d'environnement `SESSION_SECRET`.
- Upgrade WebSocket refusé si l'en-tête `Origin` ne correspond pas à `PUBLIC_ORIGIN`.
- Rate limit par connexion (20 messages/s, fermeture avec le code 1008 au-delà) et par IP pour les `lookup` et les `join` (10/min au total, compteur Redis). Il empêche de tester les PIN un par un. L'IP est lue dans `X-Forwarded-For`, posé par Caddy uniquement.
- Les commandes animateur sont refusées pour un jeton `player`.

## Multi-serveurs : un écrivain unique par partie

Chaque partie a un **coordinateur** : le seul nœud qui applique les commandes et écrit l'état. Tous les autres nœuds se contentent de transmettre.

### Cycle d'une commande

1. Un client envoie un message à n'importe quel nœud. Le nœud le valide (zod, jeton, rate limit), l'horodate (`at = Date.now()`) et l'ajoute au stream `game:{id}:commands`.
2. Pour une réponse, le nœud renvoie aussitôt `answer_received`. Ça confirme la réception, pas la validité.
3. Le coordinateur lit les commandes, appelle `reduce`, puis exécute le script Lua générique `commit` (aucune logique métier) : il vérifie que le lease porte toujours son token, écrit le nouvel état (qui contient l'id de la dernière commande traitée) et ajoute les événements au stream `game:{id}:events`, le tout de façon atomique.
4. Chaque nœud lit les streams d'événements des parties dont il sert au moins un client. Pour chaque socket locale, il applique `project` et envoie le résultat.

Seule exception, `lookup` est une lecture : il ne passe pas par le coordinateur. Le nœud lit l'état dans Redis et répond avec la vue `visitor` (mode et équipes, rien d'autre).

Les échéances passent par le même chemin : le coordinateur programme un `setTimeout` sur `deadline`, qui ajoute une commande `timeout` au stream.

### Coordinateur et lease

- Le lease `game:{id}:lease` vaut `{nodeId}:{token}` et expire au bout de 5 s (`SET NX PX`). Il est renouvelé toutes les 1,5 s. Le token provient de `INCR game:{id}:fence` (fencing token).
- Tout nœud qui sert un client d'une partie sans coordinateur tente d'acquérir le lease. Le gagnant charge l'état, applique les commandes postérieures à la dernière traitée, puis reprogramme le chrono à partir de `deadline`.
- Un ancien coordinateur (pause GC, coupure réseau) ne peut plus rien écrire : `commit` rejette son token.
- Après chaque `commit`, les commandes traitées sont supprimées (`XTRIM MINID`).

### Diffusion

- L'ID d'une entrée du stream d'événements est `{seq}-0`, ce qui permet un `XRANGE` direct par numéro de séquence. Le stream est plafonné à environ 1000 entrées (`MAXLEN ~`).
- Chaque nœud a une seule boucle `XREAD BLOCK` (200 ms) sur les streams de ses parties actives. Ce délai court permet d'intégrer une nouvelle partie sans connexion Redis supplémentaire.
- Pas de tempête de messages : la liste des joueurs ne va qu'à l'écran animateur, et `answer_count` est limité à un envoi toutes les 250 ms par le coordinateur.

### Reconnexion

- Côté client : reconnexion avec un délai qui double à chaque tentative (250 ms au départ, 5 s maximum), plus une part d'aléatoire.
- `hello { token, lastSeq }` : le nœud envoie les événements à partir de `lastSeq + 1`. S'ils ne sont plus dans le stream, il envoie un `snapshot` à la place.

### Chrono synchronisé

Le serveur envoie une échéance absolue. Le client estime l'écart entre son horloge et celle du serveur grâce à 5 `ping`/`pong` (médiane de `serverTime - (t0 + t1) / 2`) et affiche un compte à rebours aligné.

### Arrêt progressif

Sur `SIGTERM`, le nœud :
1. cesse d'accepter des connexions ;
2. relâche ses leases (seulement si le token correspond) ;
3. ferme ses sockets avec le code 1012 (Service Restart) ;
4. s'arrête.

Les clients se reconnectent sur un autre nœud et reprennent via `lastSeq`.

## Clés Redis

```
pin:{pin}               -> gameId                         TTL
game:{id}:state         état JSON, validé par zod à la lecture
game:{id}:commands      stream des commandes entrantes
game:{id}:events        stream des événements, ID = {seq}-0, MAXLEN ~1000
game:{id}:lease         {nodeId}:{token}, PX 5000
game:{id}:fence         compteur de fencing tokens
ratelimit:join:{ip}     compteur, TTL 60 s
```

Toutes les clés d'une partie ont un TTL de 2 h, renouvelé à chaque `commit`.

## Observabilité

Chaque log pino porte `nodeId` (le hostname du conteneur) et, quand ils s'appliquent, `gameId` et `playerId`, via des child loggers. On logue les connexions, les fermetures, les acquisitions et pertes de lease, les transitions de phase et les erreurs.

## Limites connues

- **Redis est un point unique de défaillance.** Assumé pour ce projet ; Sentinel ou Cluster sont hors périmètre.
- **Si un nœud crashe, ses joueurs restent affichés comme "connectés"** jusqu'à ce qu'ils se reconnectent ailleurs. Il n'y a pas de heartbeat de présence par joueur.
- **`at` est mesuré par l'horloge du nœud qui reçoit la réponse.** Plusieurs machines doivent donc être synchronisées par NTP. En dev, tous les conteneurs partagent la même horloge.
