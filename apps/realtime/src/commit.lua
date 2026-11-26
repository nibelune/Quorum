-- Applique atomiquement le résultat d'un lot de commandes, sans aucune logique de jeu :
-- écrit l'état, ajoute les événements, supprime les commandes appliquées et renouvelle le TTL de la partie.
-- KEYS : état, événements, commandes, pin, propriétaire
-- ARGV : état JSON, MINID des commandes à garder, TTL en secondes, puis des paires (ID {seq}-0, événement JSON)
local ttl = tonumber(ARGV[3])
redis.call("SET", KEYS[1], ARGV[1], "EX", ttl)
for i = 4, #ARGV, 2 do
  redis.call("XADD", KEYS[2], "MAXLEN", "~", 1000, ARGV[i], "event", ARGV[i + 1])
end
redis.call("XTRIM", KEYS[3], "MINID", ARGV[2])
for i = 2, #KEYS do
  redis.call("EXPIRE", KEYS[i], ttl)
end
