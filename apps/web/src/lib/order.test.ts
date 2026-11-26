import { expect, test } from "vitest";
import { playerChoices } from "./order.ts";

const choices = ["Sydney", "Canberra", "Melbourne", "Perth"];

test.each([2, 3, 4])("garde chacun des %d choix, avec sa position dans la question", (count) => {
  const shown = playerChoices(choices.slice(0, count), "question:Alice");
  expect(shown.map(({ index }) => index).toSorted()).toEqual([...Array(count).keys()]);
  for (const { index, text } of shown) expect(text).toBe(choices[index]);
});

test("un joueur retrouve le même ordre pour la même question, après une reconnexion", () => {
  expect(playerChoices(choices, "question:Alice")).toEqual(playerChoices(choices, "question:Alice"));
});

test("les joueurs d'une même salle ne voient pas tous le même ordre", () => {
  const orders = ["Alice", "Bob", "Chloé", "David", "Emma", "Farid"].map((nickname) =>
    playerChoices(choices, `question:${nickname}`)
      .map(({ index }) => index)
      .join(),
  );
  expect(new Set(orders).size).toBeGreaterThan(1);
});
