import { z } from "zod";
import { ChoiceIndex, Nickname, Pin, PlayerId, QuestionId } from "./domain.ts";

export const PROTOCOL_VERSION = 1;

export const ClientMessage = z.discriminatedUnion("type", [
  // Toute version est acceptée ici : un client périmé doit recevoir `reload`, pas une erreur de validation.
  z.object({
    type: z.literal("hello"),
    protocolVersion: z.int(),
    token: z.string().optional(),
    // Reconnexion : dernier événement reçu. Le serveur renvoie la suite, ou un snapshot si elle n'est plus dans le stream.
    lastSeq: z.int().nonnegative().optional(),
  }),
  z.object({ type: z.literal("join"), pin: Pin, nickname: Nickname }),
  z.object({ type: z.literal("answer"), questionId: QuestionId, choiceIndex: ChoiceIndex }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("kick"), playerId: PlayerId }),
  z.object({ type: z.literal("end") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
