# 0011 : front rendu côté client (SPA)

- Statut : acceptée
- Date : 2026-11-26

## Contexte

`apps/web` (SvelteKit, `adapter-node`) sert trois interfaces : le dashboard de l'animateur, derrière une connexion ; l'écran projeté et l'app joueur, pilotés par le WebSocket. Les données viennent de l'API (`/api`) et de `realtime` (`/ws`), derrière Caddy sur la même origine.

## Décision

Le rendu côté serveur est désactivé pour toute l'application (`ssr = false` dans le layout racine). Le serveur Node sert une coquille HTML, et le navigateur appelle directement l'API et le WebSocket. Le style repose sur le CSS scopé de Svelte et quelques variables CSS globales, sans framework CSS.

## Raisons

- Chaque appel part du navigateur avec le cookie de session, à travers Caddy. Il n'y a aucun appel de serveur à serveur ni cookie à retransmettre depuis les `load`.
- Le SEO ne compte pas : les pages sont derrière une connexion ou n'ont de sens que pendant une partie.
- L'écran projeté et l'app joueur sont de toute façon rendus par les messages du WebSocket, côté client.
- Le CSS scopé n'ajoute aucune dépendance et garde le style de chaque composant à côté de son balisage.

## Conséquences

- Le premier affichage attend le chargement du JavaScript. C'est acceptable pour une app utilisée en salle, souvent sur le réseau local.
- `adapter-node` reste en place : le rendu côté serveur pourra être réactivé page par page si un besoin apparaît (une page d'accueil publique, par exemple).
