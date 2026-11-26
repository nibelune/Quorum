import { expect, test } from "vitest";
import { GameId, PlayerId, TeamId } from "./domain.ts";
import { signToken, type TokenPayload, verifyToken } from "./token.ts";

const secret = "secret-de-test-".padEnd(32, "x");
const now = 1_000_000;
const gameId = GameId.parse(crypto.randomUUID());
const player: TokenPayload = {
  role: "player",
  gameId,
  playerId: PlayerId.parse(crypto.randomUUID()),
  teamId: TeamId.parse(crypto.randomUUID()),
};
const host: TokenPayload = { role: "host", gameId, exp: now + 1 };

test.each([player, host])("relit le jeton $role qu'il a signé", (payload) => {
  expect(verifyToken(signToken(payload, secret), secret, now)).toEqual(payload);
});

test.each([
  ["signé avec un autre secret", signToken(player, "autre-secret-".padEnd(32, "x"))],
  ["dont le contenu a été modifié", signToken(player, secret).replace(/^[^.]+/, signToken(host, secret).split(".")[0] ?? "")],
  ["animateur expiré", signToken({ ...host, exp: now - 1 }, secret)],
  ["mal formé", "n'importe quoi"],
])("refuse un jeton %s", (_, token) => {
  expect(verifyToken(token, secret, now)).toBeNull();
});
