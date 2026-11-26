# Roadmap de Quorum

**Phase en cours : 1**

## Phase 1 : jouable de bout en bout (1 nœud realtime)

L'architecture cible est en place dès le départ (Redis, streams, `commit`), avec un seul nœud. On évite ainsi une réécriture en phase 2.

- [x] Monorepo (`.nvmrc`, `packageManager`, `supportedArchitectures`), `packages/config` (tsconfig, ESLint), Compose de dev (Postgres, Redis), Makefile, `.claude/settings.json` (plugin Svelte)
- [x] CI GitHub Actions : lint, typecheck, test
- [x] `packages/protocol` : messages WebSocket
- [x] `packages/game-engine` : `reduce`, `project`, `snapshot`, scores. Chaque transition et chaque règle testées.
- [x] `packages/db` : quiz (questions en `jsonb`, ADR 0009), migrations Drizzle, script `migrate` exécuté en CI
- [x] `api` : auth animateur (Better Auth, email + mot de passe), CRUD quiz (QCM, vrai/faux), création de partie + PIN, jeton animateur, tables Better Auth (utilisateurs) et clé étrangère `quizzes.owner_id`, schémas HTTP dans `packages/protocol`. Premiers services applicatifs du Compose : `migrate`, `api`, Caddy, `.env.example`
- [x] `realtime` : connexion, `hello`, `join`, jetons, chemin commande -> coordinateur -> événements, renvoi des erreurs de `reduce` à l'expéditeur (Pub/Sub, ADR 0010), chrono (`tick`), rate limits
- [x] `web` : dashboard (liste et édition des quiz), écran projeté (lobby avec QR code, question, révélation, classement, podium), app joueur
- [x] E2E Playwright : un animateur et trois joueurs jouent une partie complète

## Phase 2 : multi-serveurs

- [x] Lease, fencing token, reprise par un autre nœud
- [x] `realtime` à 3 répliques dans le Compose, arrêt progressif (`SIGTERM`, code 1012)
- [ ] Reconnexion client avec backoff, rejeu par `lastSeq`, repli sur `snapshot`
- [ ] `make chaos` : test automatisé qui tue un nœud en pleine partie et vérifie que la partie se termine normalement
- [ ] Synchronisation d'horloge par `ping`/`pong`
- [ ] Mise en ligne sur Railway (un Dockerfile par app, HTTPS, `realtime` en 3 répliques) : première démo en ligne
- [ ] Mode équipes : moteur (équipes, capitaine, score d'équipe), protocole (`lookup`, `team_answer_locked`...), écrans (choix de l'équipe au `join`, choix du capitaine visible par l'équipe, classement par équipes), e2e avec deux équipes

## Phase 3 : produit

- [ ] `worker` (BullMQ) : persistance des résultats en fin de partie
- [ ] Statistiques après la partie (par question, par joueur)
- [ ] Bibliothèque de quiz : duplication, import
- [ ] Nouveaux types de questions : sondage, nuage de mots, remise dans l'ordre

## Phase 4 : SaaS et vitrine

- [ ] Organisations et rôles
- [ ] Stripe : plans selon le nombre de joueurs par partie
- [ ] OpenTelemetry
- [ ] Vue ops en direct : nœuds, connexions par nœud, messages par seconde, parties coordonnées par chaque nœud
- [ ] Test de charge k6 (`make load`) : résultats p50/p95/p99 et nombre de connexions simultanées dans le README
- [ ] README vitrine : démo, schéma d'architecture, vidéo du test de chaos
