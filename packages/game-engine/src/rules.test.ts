import { expect, test } from "vitest";
import { GRACE_MS, podium, pointsFor, rankOf, top } from "./rules.ts";
import type { Player } from "./state.ts";
import { alice, capital, T0 } from "./testing.ts";

const duration = capital.durationSec * 1000;

test.each([
  ["répond instantanément", 0, 1000],
  ["répond à mi-temps", duration / 2, 750],
  ["répond au dernier moment", duration, 500],
  ["répond pendant la tolérance réseau", duration + GRACE_MS, 500],
  ["semble répondre avant le début (décalage d'horloge)", -100, 1000],
])("une bonne réponse rapporte les points attendus quand le joueur %s", (_, elapsed, points) => {
  expect(pointsFor(capital, T0, { playerId: alice, choiceIndex: capital.correctIndex, at: T0 + elapsed })).toBe(points);
});

test.each([
  ["une mauvaise réponse", { playerId: alice, choiceIndex: 0, at: T0 }],
  ["une absence de réponse", undefined],
])("%s ne rapporte rien", (_, answer) => {
  expect(pointsFor(capital, T0, answer)).toBe(0);
});

const players = (...scores: number[]): Player[] =>
  scores.map((score, index) => ({ playerId: alice, nickname: `Joueur ${String(index + 1)}`, score }));

test("le top garde les 10 meilleurs, du plus haut score au plus bas, l'arrivée départageant les égalités", () => {
  const standings = top(players(10, 30, 20, 30, 0, 0, 0, 0, 0, 0, 0, 5));
  expect(standings).toHaveLength(10);
  expect(standings.slice(0, 5)).toEqual([
    { nickname: "Joueur 2", score: 30 },
    { nickname: "Joueur 4", score: 30 },
    { nickname: "Joueur 3", score: 20 },
    { nickname: "Joueur 1", score: 10 },
    { nickname: "Joueur 12", score: 5 },
  ]);
});

test("le podium garde les 5 meilleurs", () => {
  expect(podium(players(1, 2, 3, 4, 5, 6)).map(({ score }) => score)).toEqual([6, 5, 4, 3, 2]);
});

test("des joueurs à égalité partagent le même rang", () => {
  const ranked = players(100, 100, 50);
  expect(ranked.map((player) => rankOf(ranked, player))).toEqual([1, 1, 3]);
});
