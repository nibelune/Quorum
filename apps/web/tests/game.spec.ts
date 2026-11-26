import { expect, test } from "@playwright/test";
import { answer, createQuiz, joinGame, launchGame, newPage, signUpHost } from "./helpers.ts";

test("un animateur et trois joueurs jouent une partie complète", async ({ browser }) => {
  const host = await newPage(browser);
  await signUpHost(host);
  await createQuiz(host);
  const pin = await launchGame(host);

  const [alice, bob, chloe] = await test.step("trois joueurs rejoignent avec le PIN", () =>
    Promise.all(["Alice", "Bob", "Chloé"].map((nickname) => joinGame(browser, pin, nickname))),
  );
  if (!alice || !bob || !chloe) throw new Error("Il manque un joueur");
  await expect(host.getByRole("heading", { name: "3 joueurs" })).toBeVisible();

  await test.step("question 1 : Alice et Bob trouvent, Chloé se trompe", async () => {
    await host.getByRole("button", { name: "Lancer la partie" }).click();
    await expect(host.getByRole("img", { name: "Illustration de la question" })).toBeVisible();
    await answer([
      [alice, "Canberra"],
      [bob, "Canberra"],
      [chloe, "Sydney"],
    ]);
    await expect(alice.getByText("Bonne réponse !")).toBeVisible();
    await expect(chloe.getByText("Raté…")).toBeVisible();
    await host.getByRole("button", { name: "Classement" }).click();
    await expect(chloe.getByText("Tu es 3e")).toBeVisible();
  });

  await test.step("question 2 : seule Alice trouve", async () => {
    await host.getByRole("button", { name: "Suivant" }).click();
    await answer([
      [alice, "Faux"],
      [bob, "Vrai"],
      [chloe, "Vrai"],
    ]);
    await expect(bob.getByText("Raté…")).toBeVisible();
    await host.getByRole("button", { name: "Classement" }).click();
    await host.getByRole("button", { name: "Suivant" }).click();
  });

  await test.step("le podium s'affiche partout", async () => {
    await expect(host.getByRole("heading", { name: "Podium" })).toBeVisible();
    await expect(host.getByRole("listitem")).toHaveText([/Alice/, /Bob/, /Chloé/]);
    await expect(chloe.getByRole("heading", { name: "Podium" })).toBeVisible();
  });
});
