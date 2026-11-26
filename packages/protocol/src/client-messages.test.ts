import { expect, test } from "vitest";
import { ClientMessage, PROTOCOL_VERSION } from "./client-messages.ts";

const questionId = crypto.randomUUID();

test.each([
  ["un lookup avec un PIN commençant par 0", { type: "lookup", pin: "012345" }],
  ["un join en solo", { type: "join", nickname: "Alice" }],
  ["un join qui crée une équipe", { type: "join", nickname: "Alice", team: { create: "Les Quizzards" } }],
  ["un join qui rejoint une équipe", { type: "join", nickname: "Alice", team: { join: crypto.randomUUID() } }],
  ["une réponse au quatrième choix", { type: "answer", questionId, choiceIndex: 3 }],
])("accepte %s", (_, message) => {
  expect(ClientMessage.safeParse(message).error).toBeUndefined();
});

test("accepte un hello d'une autre version, pour pouvoir répondre reload", () => {
  expect(ClientMessage.safeParse({ type: "hello", protocolVersion: PROTOCOL_VERSION + 1 }).error).toBeUndefined();
});

test("retire les espaces autour du pseudo et du nom d'équipe", () => {
  expect(ClientMessage.parse({ type: "join", nickname: "  Alice ", team: { create: " Les Quizzards " } })).toEqual({
    type: "join",
    nickname: "Alice",
    team: { create: "Les Quizzards" },
  });
});

test.each([
  ["un PIN de 5 chiffres", { type: "lookup", pin: "12345" }],
  ["un PIN non numérique", { type: "lookup", pin: "12a456" }],
  ["un pseudo vide une fois les espaces retirés", { type: "join", nickname: "   " }],
  ["un pseudo de 21 caractères", { type: "join", nickname: "a".repeat(21) }],
  ["un nom d'équipe de 25 caractères", { type: "join", nickname: "Alice", team: { create: "a".repeat(25) } }],
  ["une équipe à rejoindre qui n'est pas un UUID", { type: "join", nickname: "Alice", team: { join: "rouges" } }],
  ["un choix hors limites", { type: "answer", questionId, choiceIndex: 4 }],
  ["un choix non entier", { type: "answer", questionId, choiceIndex: 1.5 }],
  ["un identifiant de question qui n'est pas un UUID", { type: "answer", questionId: "q1", choiceIndex: 0 }],
])("refuse %s", (_, message) => {
  expect(ClientMessage.safeParse(message).success).toBe(false);
});
