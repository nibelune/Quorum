import { z } from "zod";
import { ChoiceIndex, Nickname, Pin, PlayerId, QuestionId, TeamId, TeamName } from "./domain.ts";

export const PROTOCOL_VERSION = 3;

// En mode équipes, le joueur crée une équipe ou en rejoint une existante.
export const TeamChoice = z.union([z.object({ create: TeamName }), z.object({ join: TeamId })]);
export type TeamChoice = z.infer<typeof TeamChoice>;

export const ClientMessage = z.discriminatedUnion("type", [
  // Toute version est acceptée ici : un client périmé doit recevoir `reload`, pas une erreur de validation.
  z.object({
    type: z.literal("hello"),
    protocolVersion: z.int(),
    token: z.string().optional(),
    // Reconnexion : dernier événement reçu. Le serveur renvoie la suite, ou un snapshot si elle n'est plus dans le stream.
    lastSeq: z.int().nonnegative().optional(),
  }),
  // Synchronisation d'horloge : t est l'heure du client à l'envoi, renvoyée telle quelle dans le pong.
  z.object({ type: z.literal("ping"), t: z.number() }),
  // Avant de rejoindre : le serveur répond `game_info` (mode et équipes), puis tient la liste des équipes à jour.
  z.object({ type: z.literal("lookup"), pin: Pin }),
  // Rejoint la partie trouvée par `lookup`.
  z.object({ type: z.literal("join"), nickname: Nickname, team: TeamChoice.optional() }),
  z.object({ type: z.literal("answer"), questionId: QuestionId, choiceIndex: ChoiceIndex }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("kick"), playerId: PlayerId }),
  z.object({ type: z.literal("end") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
