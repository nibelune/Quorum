import { expect, test } from "vitest";
import { ClientMessage, PROTOCOL_VERSION } from "./client-messages.ts";

const questionId = crypto.randomUUID();

test.each([
  ["un join avec un PIN commençant par 0", { type: "join", pin: "012345", nickname: "Alice" }],
  ["une réponse au quatrième choix", { type: "answer", questionId, choiceIndex: 3 }],
])("accepte %s", (_, message) => {
  expect(ClientMessage.safeParse(message).error).toBeUndefined();
});

test("accepte un hello d'une autre version, pour pouvoir répondre reload", () => {
  expect(ClientMessage.safeParse({ type: "hello", protocolVersion: PROTOCOL_VERSION + 1 }).error).toBeUndefined();
});

test("retire les espaces autour du pseudo", () => {
  expect(ClientMessage.parse({ type: "join", pin: "123456", nickname: "  Alice " })).toEqual({
    type: "join",
    pin: "123456",
    nickname: "Alice",
  });
});

test.each([
  ["un PIN de 5 chiffres", { type: "join", pin: "12345", nickname: "Alice" }],
  ["un PIN non numérique", { type: "join", pin: "12a456", nickname: "Alice" }],
  ["un pseudo vide une fois les espaces retirés", { type: "join", pin: "123456", nickname: "   " }],
  ["un pseudo de 21 caractères", { type: "join", pin: "123456", nickname: "a".repeat(21) }],
  ["un choix hors limites", { type: "answer", questionId, choiceIndex: 4 }],
  ["un choix non entier", { type: "answer", questionId, choiceIndex: 1.5 }],
  ["un identifiant de question qui n'est pas un UUID", { type: "answer", questionId: "q1", choiceIndex: 0 }],
])("refuse %s", (_, message) => {
  expect(ClientMessage.safeParse(message).success).toBe(false);
});
