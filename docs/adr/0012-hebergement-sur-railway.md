# 0012 : hébergement sur Railway, infrastructure décrite en code

- Statut : acceptée
- Date : 2026-11-26

## Contexte

La phase 2 met en ligne une première démo, multi-serveurs. Le plan initial était un VPS, un `compose.prod.yaml` et Caddy en HTTPS automatique. Il fallait alors administrer un serveur : système, certificats, sauvegardes, redémarrages.

## Décision

Quorum est hébergé sur Railway. L'infrastructure de production est décrite dans `.railway/railway.ts` (Infrastructure as Code de Railway) et appliquée à la main par `railway config plan`, puis `railway config apply`.

- Chaque app est construite depuis son Dockerfile (`apps/*/Dockerfile`, `docker/caddy.Dockerfile`) et redéployée à chaque push sur `main`, une fois la CI verte, si ses sources ont changé.
- Caddy reste le seul service public. Railway ne route pas par chemin, et ses sous-domaines (`*.up.railway.app`) sont sur la Public Suffix List : le cookie de session impose une origine unique pour `/api`, `/ws` et le web. Le point d'entrée de Railway termine le HTTPS devant Caddy.
- `realtime` tourne en 3 répliques. Railway ne répartit pas le trafic privé, mais son DNS interne renvoie toutes les répliques : Caddy les trouve avec ses upstreams dynamiques, comme en dev (ADR 0008).
- Postgres et Redis tournent à partir des images `postgres:17` et `redis:7.4`, avec des volumes : les mêmes versions qu'en dev et en CI (ADR 0006).
- La migration est la commande de pré-déploiement de `api` : si elle échoue, le déploiement s'arrête.
- L'IP du client vient de `X-Real-IP`, que le point d'entrée de Railway écrase à chaque requête et que Caddy transmet à `api` et `realtime`.

## Raisons

- Aucun serveur à administrer : HTTPS, healthchecks, répliques, arrêt progressif (`SIGTERM` puis délai) et redéploiements sont fournis.
- L'infrastructure se relit et se rejoue comme du code, dans le dépôt.
- Les images de production restent standard : rien n'empêche de revenir à un VPS.

## Conséquences

- **Exception à l'ADR 0006** : le SDK `railway` (3.17.0) et la CLI 5 sont récents. L'ancien format (`railway.json`) n'est plus lu à partir du 1er décembre 2026 : l'IaC est la seule façon de garder l'infrastructure dans le dépôt.
- `compose.prod.yaml` est abandonné ; `compose.yaml` reste l'environnement de dev.
- Postgres et Redis ne sont pas des bases gérées par Railway : pas de sauvegarde automatique pour l'instant.
- En production, Better Auth limite les inscriptions et connexions par IP (par exemple 3 inscriptions par 10 secondes).
- Railway injecte `PORT` et y adresse ses healthchecks : chaque app le fixe au port sur lequel elle écoute (3000).
- Le domaine public est `quorum-live.up.railway.app` (`quorum.up.railway.app` était déjà pris).
- Le coût dépend de l'usage : 8 conteneurs, dont 3 répliques de `realtime`.
