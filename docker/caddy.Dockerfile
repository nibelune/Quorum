# Caddy de production : le point d'entrée public, avec le même Caddyfile qu'en dev.
FROM caddy:2
COPY docker/Caddyfile /etc/caddy/Caddyfile
