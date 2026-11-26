-- Applique atomiquement le résultat d'un lot de commandes, sans aucune logique de jeu :
-- vérifie que le coordinateur détient toujours le lease (fencing), écrit l'état, ajoute les événements,
-- supprime les commandes appliquées et renouvelle le TTL de la partie.
-- KEYS : lease, état, événements, commandes, pin, propriétaire, compteur de fencing
-- ARGV : valeur du lease, état JSON, MINID des commandes à garder, TTL en secondes, puis des paires (ID {seq}-0, événement JSON)
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return redis.error_reply("LEASE_LOST")
end
local ttl = tonumber(ARGV[4])
redis.call("SET", KEYS[2], ARGV[2], "EX", ttl)
for i = 5, #ARGV, 2 do
  redis.call("XADD", KEYS[3], "MAXLEN", "~", 1000, ARGV[i], "event", ARGV[i + 1])
end
redis.call("XTRIM", KEYS[4], "MINID", ARGV[3])
for i = 3, #KEYS do
  redis.call("EXPIRE", KEYS[i], ttl)
end
