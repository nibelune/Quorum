// Chaque téléphone présente les choix dans son propre ordre : dans une salle, « la troisième réponse » ou « le triangle bleu »
// ne désigne pas la même réponse pour tous. L'ordre est tiré de la question et du pseudo : un joueur qui se reconnecte
// le retrouve tel quel. `index` reste la position du choix dans la question, celle qu'attend le serveur.
export function playerChoices(choices: string[], seed: string): { index: number; text: string }[] {
  const random = seededRandom(seed);
  const remaining = choices.map((text, index) => ({ index, text }));
  const shuffled: typeof remaining = [];
  while (remaining.length > 0) shuffled.push(...remaining.splice(Math.floor(random() * remaining.length), 1));
  return shuffled;
}

// Hachage FNV-1a de la graine, puis générateur mulberry32 : déterministe, sans dépendance.
function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ (char.codePointAt(0) ?? 0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
