import { describe, expect, test } from "vitest";
import { GRACE_MS, podium, pointsFor, rankOf, shuffleChoices, top } from "./rules.ts";
import type { Team } from "./state.ts";
import { alice, capital, red, T0 } from "./testing.ts";

const duration = capital.durationSec * 1000;

test.each([
  ["répond instantanément", 0, 1000],
  ["répond à mi-temps", duration / 2, 750],
  ["répond au dernier moment", duration, 500],
  ["répond pendant la tolérance réseau", duration + GRACE_MS, 500],
  ["semble répondre avant le début (décalage d'horloge)", -100, 1000],
])("une bonne réponse rapporte les points attendus quand le joueur %s", (_, elapsed, points) => {
  expect(pointsFor(capital, T0, { playerId: alice, teamId: red, choiceIndex: capital.correctIndex, at: T0 + elapsed })).toBe(points);
});

test.each([
  ["une mauvaise réponse", { playerId: alice, teamId: red, choiceIndex: 0, at: T0 }],
  ["une absence de réponse", undefined],
])("%s ne rapporte rien", (_, answer) => {
  expect(pointsFor(capital, T0, answer)).toBe(0);
});

const teams = (...scores: number[]): Team[] =>
  scores.map((score, index) => ({ teamId: red, name: `Équipe ${String(index + 1)}`, score }));

test("le top garde les 10 meilleures équipes, du plus haut score au plus bas, l'arrivée départageant les égalités", () => {
  const standings = top(teams(10, 30, 20, 30, 0, 0, 0, 0, 0, 0, 0, 5));
  expect(standings).toHaveLength(10);
  expect(standings.slice(0, 5)).toEqual([
    { name: "Équipe 2", score: 30 },
    { name: "Équipe 4", score: 30 },
    { name: "Équipe 3", score: 20 },
    { name: "Équipe 1", score: 10 },
    { name: "Équipe 12", score: 5 },
  ]);
});

test("le podium garde les 5 meilleures", () => {
  expect(podium(teams(1, 2, 3, 4, 5, 6)).map(({ score }) => score)).toEqual([6, 5, 4, 3, 2]);
});

test("des équipes à égalité partagent le même rang", () => {
  const ranked = teams(100, 100, 50);
  expect(ranked.map((player) => rankOf(ranked, player))).toEqual([1, 1, 3]);
});

describe("shuffleChoices", () => {
  const sequence = (...values: number[]) => () => values.shift() ?? 0;

  test("réordonne les choix et suit la bonne réponse", () => {
    // Chaque tirage prend l'un des choix restants : 0,9 le dernier, 0,5 celui du milieu, 0 le premier.
    expect(shuffleChoices(capital, sequence(0.9, 0))).toMatchObject({ choices: ["Melbourne", "Sydney", "Canberra"], correctIndex: 2 });
    expect(shuffleChoices(capital, sequence(0.5, 0))).toMatchObject({ choices: ["Canberra", "Sydney", "Melbourne"], correctIndex: 0 });
  });

  test("garde l'ordre d'origine avec un aléa nul", () => {
    expect(shuffleChoices(capital, () => 0)).toEqual(capital);
  });
});
