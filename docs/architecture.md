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
                     Postgres ◄── worker ── Redis
              (comptes, quiz, résultats)  (parties en cours, file BullMQ)
```

- En production (Railway, ADR 0012), le point d'entrée public de Railway termine le HTTPS devant Caddy.
- **web** (SvelteKit) est rendu côté client (ADR 0011) : le navigateur appelle directement l'API et le WebSocket, à travers Caddy.
- **api** gère les comptes, les quiz et la création des parties. Il enregistre la partie dans Postgres, écrit son état initial dans Redis et délivre les jetons animateur. Il sert aussi les résultats des parties terminées : classement et statistiques par question, calculés en SQL.
- **realtime** gère tout le reste du cycle de vie d'une partie. Il ne parle qu'à Redis, jamais à Postgres.
- **worker** exécute les tâches BullMQ : à la fin d'une partie, il copie ses résultats de Redis vers Postgres (ADR 0014) ; chaque nuit, il supprime les images qu'aucun quiz ni aucune partie n'utilise (ADR 0013).
- **Postgres** contient les comptes et les quiz. Les questions d'un quiz sont stockées dans une colonne `jsonb` de la table `quizzes` (ADR 0009).
- **Bucket S3** : les images des questions, que l'API est seule à lire et écrire (ADR 0013). En dev, `adobe/s3mock` le remplace.

## Déroulé d'une partie

Phases : `lobby` -> `question` -> `reveal` -> `leaderboard` -> (question suivante ou) `ended`

- Une question a un énoncé (300 caractères max), 2 à 4 choix (120 caractères max), une seule bonne réponse, une durée de 5 à 300 s et, au besoin, une image (JPEG, PNG ou WebP, 2 Mo max, ADR 0013). Une question vrai/faux est un QCM à deux choix.
- Les choix de chaque question sont mélangés une fois, à la création de la partie : l'ordre de l'auteur ne se retrouve pas à l'écran. Chaque téléphone les présente en plus dans son propre ordre, tiré de la question et du pseudo, pour qu'un joueur le retrouve après une reconnexion : dans une salle, « la troisième réponse » ou « le triangle bleu » ne désigne pas la même réponse pour tous. Sur chaque écran, formes et couleurs suivent la position, et le joueur répond d'après le texte.
- Pendant une question, l'écran projeté consacre ses deux tiers du haut à l'énoncé, posé sur l'image, et son tiers du bas aux réponses, en 2 × 2. Les téléphones reprennent une grille 2 × 2, sans l'image.
- L'animateur crée une partie depuis le dashboard et choisit le mode : `solo` ou `teams`. Un PIN à 6 chiffres et un QR code s'affichent sur l'écran projeté.
- Les joueurs rejoignent avec un pseudo (1 à 20 caractères, unique dans la partie sans tenir compte de la casse). On peut rejoindre jusqu'à la fin de la partie : un retardataire commence à 0 point.
- L'animateur peut exclure un joueur : celui-ci est prévenu (`error { code: "kicked" }`) et ne peut plus répondre.
- Pendant `question`, chaque joueur répond une seule fois. Une réponse compte si elle est reçue avant `deadline + GRACE_MS` (250 ms de tolérance réseau). La question se termine à ce moment-là, dès que tous les joueurs ont répondu, ou quand l'animateur passe à la suite.
- Pendant `reveal`, on affiche la bonne réponse et la répartition des votes. La bonne réponse n'est **jamais** envoyée avant.
- Pendant `leaderboard`, on affiche les 10 premiers ; chaque joueur voit aussi son rang sur son téléphone.
- `ended` affiche le podium : les 5 premiers, qui restent à l'écran.

**Score** d'une réponse correcte : `round(1000 * (1 - (tempsDeReponse / dureeQuestion) / 2))`, soit entre 500 et 1000. Réponse fausse, tardive ou absente : 0. Le temps de réponse est mesuré à la réception par le serveur.

### Mode équipes (ADR 0007)

Pensé pour les soirées en bar : une équipe par table, qui discute avant de répondre.

- En rejoignant, le joueur crée une équipe (nom de 1 à 24 caractères, unique dans la partie) ou rejoint une équipe existante. Il ne peut plus en changer ensuite. Après le lancement de la partie, on ne peut plus créer d'équipe, seulement en rejoindre une.
- Le créateur de l'équipe en est le **capitaine**. Lui seul envoie la réponse de l'équipe ; une réponse envoyée par un autre membre est refusée (`not_captain`).
- Dès que le capitaine a répondu, ses coéquipiers voient son choix sur leur téléphone (`team_answer_locked`). Les autres équipes ne le voient pas.
- Si le capitaine est exclu, le membre arrivé le plus tôt devient capitaine (`captain_changed`) ; la réponse de l'exclu part avec lui, et son successeur peut répondre. Un joueur ne quitte jamais une partie de lui-même : si le téléphone du capitaine s'éteint, l'animateur l'exclut. Une équipe vide disparaît.
- Le score se calcule comme en solo, sur la réponse et le temps de réponse du capitaine, et il est attribué à l'équipe. Le classement et le podium sont ceux des équipes.
- Une table avec un seul téléphone forme simplement une équipe d'un membre.

**Accessibilité** : chaque choix de réponse est identifié par une forme et une couleur, jamais par la couleur seule. Les animations respectent `prefers-reduced-motion`.

## Game engine (`packages/game-engine`)

Toute la logique de jeu, sans I/O ni horloge :

```ts
reduce(state: GameState, command: Command):
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: ErrorCode }

project(event: GameEvent, to: Recipient): ServerMessage | null   // ce que ce destinataire a le droit de voir
snapshot(state: GameState, to: Recipient): ServerMessage          // vue complète pour une reprise
```

Le moteur a toujours des équipes : en solo, chaque joueur forme une équipe d'un membre, à son nom, dont il est le capitaine. Scores, classements et podium portent donc toujours sur les équipes, sans cas particulier ; le mode n'intervient qu'au `join`.

Chaque commande porte `at` (horodatage de réception). `project` et `snapshot` garantissent qu'un joueur ne reçoit que ce qui le concerne. C'est là que la bonne réponse est masquée avant `reveal`, et que le choix d'un capitaine n'est montré qu'à son équipe.

`Recipient` vaut `{ role: "host" }`, `{ role: "player", playerId, teamId }` ou `{ role: "visitor" }` (un joueur qui a saisi le PIN mais n'a pas encore rejoint la partie). Sa vue, `{ role: "visitor", mode, teams, canCreateTeam }`, ne contient que de quoi choisir son équipe ; en solo, il n'y en a pas à choisir. Dans la vue de l'animateur, chaque joueur porte son équipe, et les membres d'une équipe sont dans l'ordre d'arrivée : le premier est le capitaine.

## Protocole (`packages/protocol`)

Messages JSON validés par zod, union discriminée sur `type`. Taille maximale : 4 Kio.

**Client -> serveur**
- Tous : `hello { protocolVersion, token?, lastSeq? }` (premier message de chaque connexion), `ping { t }`
- Joueur : `lookup { pin }` (avant de rejoindre : récupère le mode et la liste des équipes), puis `join { nickname, team? }` dans la partie trouvée, avec `team` = `{ create: name }` ou `{ join: teamId }` en mode équipes, `answer { questionId, choiceIndex }`
- Animateur : `start`, `next`, `kick { playerId }`, `end`

**Serveur -> client**
- Issus du flux d'événements, avec `seq` : `player_joined { playerId, nickname, team }` (animateur), `team_created { team }` (visiteurs, en mode équipes), `player_left`, `captain_changed { captain }` et `team_answer_locked { choiceIndex }` (équipe concernée uniquement), `question_started { questionId, text, choices, imageUrl?, deadline }`, `answer_count` (animateur), `question_ended { correctIndex, distribution, you? }`, `leaderboard { top, you? }`, `game_ended { podium }`. `you`, `top` et `podium` portent sur les équipes (en solo, celles d'un membre) : une ligne de classement est `{ name, score }`.
- Locaux au nœud, sans `seq` : `welcome { token }` (réponse à `join`), `snapshot { seq, view }` (aussi la réponse à `lookup`, avec la vue `visitor`), `answer_received`, `pong { t, serverTime }`, `error { code }`, `reload`

Si `protocolVersion` ne correspond pas, le serveur répond `reload` : le client recharge la page. Ça évite les incohérences après un déploiement.

## Identité et sécurité

- **Joueur** : au `join`, le nœud génère un `playerId` et un jeton HMAC (`node:crypto`) contenant `{ gameId, playerId, teamId, role: "player" }`. L'équipe étant fixée au `join`, elle peut figurer dans le jeton. Le client le garde en `sessionStorage` et le renvoie dans `hello` à chaque reconnexion.
- **Animateur** : l'écran `/host/[gameId]` demande à l'API un jeton `role: "host"`, valable 15 minutes (`POST /api/games/:id/host-token`, authentifié par la session Better Auth et réservé au propriétaire de la partie). `realtime` vérifie seulement la signature, sans accès à la base.
- Format du jeton : `base64url(payload).base64url(HMAC-SHA256)`, signé et vérifié par `@quorum/protocol/token` (réservé à Node). Un jeton animateur expiré est redemandé à l'API à la reconnexion.
- Secret HMAC partagé entre `api` et `realtime` via la variable d'environnement `SESSION_SECRET`.
- Upgrade WebSocket refusé si l'en-tête `Origin` ne correspond pas à `PUBLIC_ORIGIN`.
- Rate limit par connexion (20 messages/s, fermeture avec le code 1008 au-delà) et par IP pour les PIN inconnus : au-delà de 10 `lookup` visant un PIN inexistant en une minute, les suivants sont refusés (compteur Redis). Tester les PIN un par un reste impraticable, alors qu'une salle entière derrière une même IP (le Wi-Fi d'un bar) peut rejoindre. L'IP est lue dans `X-Real-IP`, toujours posé par Caddy : en dev, c'est l'adresse de la connexion ; en production, celle que pose le point d'entrée de Railway (ADR 0012).
- Les commandes animateur sont refusées pour un jeton `player`.

## Multi-serveurs : un écrivain unique par partie

Chaque partie a un **coordinateur** : le seul nœud qui applique les commandes et écrit l'état. Tous les autres nœuds se contentent de transmettre.

### Cycle d'une commande

1. Un client envoie un message à n'importe quel nœud. Le nœud le valide (zod, jeton, rate limit), l'horodate (`at = Date.now()`) et l'ajoute au stream `game:{id}:commands`, avec l'adresse de la connexion qui l'a reçu (`nodeId`, `connId`). Les messages d'une connexion sont traités un par un, dans l'ordre d'arrivée.
2. Pour une réponse, le nœud renvoie aussitôt `answer_received`. Ça confirme la réception, pas la validité. Sans cet accusé (la réponse a pu se perdre avec un nœud qui tombe), le client la renvoie après s'être reconnecté ; un doublon est refusé (`already_answered`), ce que le client traite comme une réponse enregistrée.
3. Le coordinateur lit les commandes par lots, appelle `reduce` pour chacune, puis exécute le script Lua générique `commit` (aucune logique métier) : il vérifie que le lease porte toujours son token, écrit le nouvel état, ajoute les événements au stream `game:{id}:events`, archive les fins de question dans `game:{id}:rounds` et supprime les commandes appliquées (`XTRIM MINID`), le tout de façon atomique. Le stream de commandes ne contient donc que des commandes en attente (ADR 0010).
4. Chaque nœud lit les streams d'événements des parties dont il sert au moins un client. Pour chaque socket locale, il applique `project` et envoie le résultat.
5. Un refus de `reduce` (`nickname_taken`, `too_late`...) et un `join` accepté appellent une réponse individuelle. Après le `commit`, le coordinateur la publie sur `node:{nodeId}:replies`, le canal Pub/Sub du nœud qui a reçu la commande (ADR 0010). Ce nœud envoie `error` à la socket, ou `welcome` puis `snapshot` pour un `join`.

Seule exception, `lookup` est une lecture : il ne passe pas par le coordinateur. Le nœud lit l'état dans Redis et répond par un `snapshot` de la vue `visitor` (mode et équipes, rien d'autre). La connexion reste ensuite abonnée à la partie comme visiteur : elle reçoit `team_created`, ce qui tient la liste des équipes à jour sans lui envoyer chaque arrivée de joueur, et son `join` vise la partie trouvée. Un `join` refusé (pseudo pris...) la laisse visiteur, prête à réessayer.

Le chrono passe par le même chemin : pendant une question, le coordinateur ajoute une commande `tick` toutes les 250 ms. Elle émet `answer_count` si le nombre de réponses a changé, et clôt la question une fois `deadline + GRACE_MS` dépassé.

### Coordinateur et lease

- Le lease `game:{id}:lease` vaut `{nodeId}:{token}` et expire au bout de 5 s (`SET NX PX`). Il est renouvelé toutes les 1,5 s. Le token provient de `INCR game:{id}:fence` (fencing token).
- Tout nœud qui sert un client d'une partie sans coordinateur tente d'acquérir le lease. Le gagnant charge l'état, applique les commandes restées dans le stream, puis reprend les `tick`.
- Un ancien coordinateur (pause GC, coupure réseau) ne peut plus rien écrire : `commit` rejette son token.
- Un nœud qui ne sert plus aucun client d'une partie relâche son lease (seulement si le token correspond) : un autre nœud la reprend aussitôt, sans attendre l'expiration.

### Diffusion

- L'ID d'une entrée du stream d'événements est `{seq}-0`, ce qui permet un `XRANGE` direct par numéro de séquence. Le stream est plafonné à environ 1000 entrées (`MAXLEN ~`).
- Chaque nœud a une seule boucle `XREAD BLOCK` (200 ms) sur les streams de ses parties actives. Ce délai court permet d'intégrer une nouvelle partie sans connexion Redis supplémentaire.
- Pas de tempête de messages : la liste des joueurs ne va qu'à l'écran animateur, et `answer_count` n'est émis qu'au `tick`, au plus toutes les 250 ms.
- Le client ignore un message dont le `seq` est inférieur ou égal au dernier reçu : juste après un `snapshot`, une socket peut recevoir des événements que celui-ci contient déjà.

### Reconnexion

- Côté client : reconnexion avec un délai qui double à chaque tentative (250 ms au départ, 5 s maximum), plus une part d'aléatoire.
- `hello { token, lastSeq }` : le nœud envoie les événements à partir de `lastSeq + 1`. S'ils ne sont plus dans le stream, il envoie un `snapshot` à la place.
- Le nœud garde pour chaque client la position du dernier événement envoyé, et seule la boucle de diffusion lui envoie des événements. Un client en retard (reconnexion, ou `snapshot` lu pendant une diffusion) est rattrapé par `XRANGE`, dans l'ordre et sans trou.
- Pendant une reconnexion, les écrans désactivent leurs boutons. L'écran projeté redemande un jeton animateur à l'API si le sien a expiré.

### Chrono synchronisé

Le serveur envoie une échéance absolue. Le client estime l'écart entre son horloge et celle du serveur grâce à 5 `ping`/`pong` (médiane de `serverTime - (t0 + t1) / 2`) et affiche un compte à rebours aligné.

### Arrêt progressif

Sur `SIGTERM`, le nœud :
1. cesse d'accepter des connexions ;
2. relâche ses leases (seulement si le token correspond) ;
3. ferme ses sockets avec le code 1012 (Service Restart) ;
4. s'arrête.

Les clients se reconnectent sur un autre nœud et reprennent via `lastSeq`.

### Fin de partie et résultats (ADR 0014)

- Chaque `question_ended` porte, pour chaque équipe, son choix, son temps de réponse et ses points. Le `commit` le recopie dans `game:{id}:rounds`, que le plafond du stream des événements n'atteint pas.
- Au `game_ended`, le coordinateur ajoute la tâche `persist-game` à la file BullMQ `jobs`, avec l'identifiant de la partie comme identifiant de tâche. Un nœud qui reprend une partie terminée l'ajoute à nouveau ; BullMQ ignore le doublon.
- Le worker lit l'état final et les fins de question, puis écrit en une transaction : la date de fin dans `games`, et les tables `game_teams`, `game_players` et `game_answers`. La tâche peut être rejouée sans dupliquer les résultats.

## Clés Redis

```
pin:{pin}               -> gameId                         TTL
game:{id}:owner         id de l'animateur propriétaire    (écrit par api, lu pour le jeton animateur)
game:{id}:state         état JSON, validé par zod à la lecture
game:{id}:commands      stream des commandes entrantes
game:{id}:events        stream des événements, ID = {seq}-0, MAXLEN ~1000
game:{id}:lease         {nodeId}:{token}, PX 5000
game:{id}:fence         compteur de fencing tokens
game:{id}:rounds        fins de question archivées pour le worker (ADR 0014)
bull:jobs:*             file BullMQ des tâches du worker
node:{nodeId}:replies   canal Pub/Sub des réponses individuelles (refus, join accepté)
ratelimit:lookup:{ip}   compteur de PIN inconnus, TTL 60 s
```

Toutes les clés d'une partie ont un TTL de 2 h, renouvelé à chaque `commit`.

## Observabilité

Chaque log pino porte `nodeId` (le hostname du conteneur) et, quand ils s'appliquent, `gameId` et `playerId`, via des child loggers. On logue les connexions, les fermetures, les acquisitions et pertes de lease, les transitions de phase et les erreurs.

## Limites connues

- **Redis est un point unique de défaillance.** Assumé pour ce projet ; Sentinel ou Cluster sont hors périmètre.
- **Si un nœud crashe, ses joueurs restent affichés comme "connectés"** jusqu'à ce qu'ils se reconnectent ailleurs. Il n'y a pas de heartbeat de présence par joueur.
- **`at` est mesuré par l'horloge du nœud qui reçoit la réponse.** Plusieurs machines doivent donc être synchronisées par NTP. En dev, tous les conteneurs partagent la même horloge.
