import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { GameId, PlayerId, TeamId } from "./domain.ts";

// Réservé à Node (node:crypto) : exporté par `@quorum/protocol/token`, jamais par l'entrée principale lue par le web.
export const TokenPayload = z.discriminatedUnion("role", [
  z.object({ role: z.literal("host"), gameId: GameId, exp: z.int() }),
  // L'équipe est fixée au `join` : elle figure dans le jeton.
  z.object({ role: z.literal("player"), gameId: GameId, playerId: PlayerId, teamId: TeamId }),
]);
export type TokenPayload = z.infer<typeof TokenPayload>;

export function signToken(payload: TokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export function verifyToken(token: string, secret: string, now: number): TokenPayload | null {
  const [body = "", signature = ""] = token.split(".");
  const expected = Buffer.from(mac(body, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  // La signature est valide : le contenu a été produit par nous, c'est donc du JSON.
  const payload = TokenPayload.safeParse(JSON.parse(Buffer.from(body, "base64url").toString()));
  if (!payload.success || (payload.data.role === "host" && payload.data.exp < now)) return null;
  return payload.data;
}

function mac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}
