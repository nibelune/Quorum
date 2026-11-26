# 0008 : Caddy plutôt que nginx comme point d'entrée

- Statut : acceptée
- Date : 2026-11-26

## Contexte

Un reverse proxy sert de point d'entrée unique : il route `/ws`, `/api` et le web, et répartit les WebSockets entre les répliques `realtime`. Les deux candidats sont nginx et Caddy.

## Décision

Caddy 2.

## Raisons

- **HTTPS automatique en prod** : les certificats Let's Encrypt sont obtenus et renouvelés sans outil supplémentaire. nginx demanderait certbot et un renouvellement planifié.
- **Répliques suivies automatiquement** : les upstreams dynamiques de Caddy relisent le DNS de Docker, donc un nœud `realtime` redémarré avec une nouvelle IP reçoit à nouveau du trafic. nginx sait le faire depuis la 1.27.3 (paramètre `resolve`), mais il faut le configurer explicitement.
- **WebSockets proxifiés sans configuration** : pas d'en-têtes `Upgrade`/`Connection` à écrire, pas de timeout de 60 s à relever.
- **Configuration courte** : une dizaine de lignes, lisibles d'un coup d'œil.

## Conséquences

- nginx est plus répandu et plus connu. Le choix de Caddy est assumé pour la simplicité de configuration, cohérente avec la priorité donnée à la simplicité.
- `X-Forwarded-For` n'est fiable que posé par Caddy : `realtime` et `api` ne lui font confiance que lorsque la requête vient de Caddy.
- Le passage à nginx resterait simple si besoin : la configuration tient en un fichier.
