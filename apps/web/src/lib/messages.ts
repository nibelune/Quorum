import type { ErrorCode } from "@quorum/protocol";

const MESSAGES: Record<ErrorCode, string> = {
  invalid_message: "Message refusé par le serveur.",
  invalid_token: "Ta session a expiré : rejoins à nouveau la partie.",
  forbidden: "Action non autorisée.",
  rate_limited: "Trop de tentatives : patiente une minute.",
  game_not_found: "Aucune partie ne correspond à ce code.",
  nickname_taken: "Ce pseudo est déjà pris dans cette partie.",
  wrong_phase: "Action impossible pour le moment.",
  already_answered: "Tu as déjà répondu.",
  too_late: "Trop tard, la question est terminée !",
  no_players: "Il faut au moins un joueur pour lancer la partie.",
  kicked: "Tu as été exclu de la partie.",
};

export function errorMessage(code: ErrorCode): string {
  return MESSAGES[code];
}
