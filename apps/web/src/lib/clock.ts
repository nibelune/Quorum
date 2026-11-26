// Écart entre l'horloge du serveur et celle du client, estimé sur un aller-retour ping/pong :
// le serveur a lu son heure à peu près à mi-chemin entre l'envoi (t0) et la réception (t1).
export function offsetSample(t0: number, t1: number, serverTime: number): number {
  return serverTime - (t0 + t1) / 2;
}

// La médiane écarte un aller-retour ralenti par le réseau.
export function clockOffset(samples: number[]): number {
  const sorted = samples.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
