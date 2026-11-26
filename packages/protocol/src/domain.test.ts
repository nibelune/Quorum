import { expect, test } from "vitest";
import { Question } from "./domain.ts";

const question = {
  id: crypto.randomUUID(),
  text: "Quelle est la capitale de l'Australie ?",
  choices: ["Sydney", "Canberra", "Melbourne", "Perth"],
  correctIndex: 1,
  durationSec: 20,
};

test.each([
  ["un QCM à quatre choix", {}],
  ["un vrai/faux", { choices: ["Vrai", "Faux"], correctIndex: 0 }],
])("accepte %s", (_, override) => {
  expect(Question.safeParse({ ...question, ...override }).error).toBeUndefined();
});

test.each([
  ["une bonne réponse hors des choix", { choices: ["Vrai", "Faux"], correctIndex: 2 }],
  ["un seul choix", { choices: ["Canberra"], correctIndex: 0 }],
  ["cinq choix", { choices: ["A", "B", "C", "D", "E"] }],
  ["un choix vide", { choices: ["Sydney", "  "] }],
  ["un choix de plus de 120 caractères", { choices: ["Sydney", "a".repeat(121)] }],
  ["un énoncé de plus de 300 caractères", { text: "a".repeat(301) }],
  ["une durée de moins de 5 s", { durationSec: 4 }],
  ["une durée de plus de 300 s", { durationSec: 301 }],
])("refuse %s", (_, override) => {
  expect(Question.safeParse({ ...question, ...override }).success).toBe(false);
});
