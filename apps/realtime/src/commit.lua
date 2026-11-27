-- Applique atomiquement le résultat d'un lot de commandes, sans aucune logique de jeu :
-- vérifie que le coordinateur détient toujours le lease (fencing), écrit l'état, ajoute les événements,
-- archive ceux qui doivent survivre au plafond du stream, supprime les commandes appliquées
-- et renouvelle le TTL de la partie.
-- KEYS : lease, état, événements, commandes, pin, propriétaire, compteur de fencing, archive
-- ARGV : valeur du lease, état JSON, MINID des commandes à garder, TTL en secondes, nombre N d'entrées à archiver,
--        ces N entrées, puis des paires (ID {seq}-0, événement JSON)
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return redis.error_reply("LEASE_LOST")
end
local ttl = tonumber(ARGV[4])
redis.call("SET", KEYS[2], ARGV[2], "EX", ttl)
local archived = tonumber(ARGV[5])
for i = 6, 5 + archived do
  redis.call("RPUSH", KEYS[8], ARGV[i])
end
for i = 6 + archived, #ARGV, 2 do
  redis.call("XADD", KEYS[3], "MAXLEN", "~", 1000, ARGV[i], "event", ARGV[i + 1])
end
redis.call("XTRIM", KEYS[4], "MINID", ARGV[3])
for i = 3, #KEYS do
  redis.call("EXPIRE", KEYS[i], ttl)
end
