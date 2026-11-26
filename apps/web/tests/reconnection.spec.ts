import { expect, test } from "@playwright/test";
import { answer, createQuiz, dropConnection, joinGame, launchGame, newPage, signUpHost } from "./helpers.ts";

test("après une coupure, l'animateur et les joueurs se reconnectent et la partie continue", async ({ browser }) => {
  const host = await newPage(browser);
  await signUpHost(host);
  await createQuiz(host);
  const pin = await launchGame(host);
  const alice = await joinGame(browser, pin, "Alice");
  await expect(host.getByRole("heading", { name: "1 joueur" })).toBeVisible();

  const bob = await test.step("l'animateur rattrape une arrivée survenue pendant sa coupure", async () => {
    // Hors ligne, ses tentatives de reconnexion échouent : il ne peut rattraper Bob qu'en revenant avec lastSeq.
    await host.context().setOffline(true);
    await dropConnection(host);
    await expect(host.getByRole("status")).toHaveText("Connexion perdue, reconnexion…");
    const player = await joinGame(browser, pin, "Bob");
    await host.context().setOffline(false);
    await expect(host.getByRole("heading", { name: "2 joueurs" })).toBeVisible({ timeout: 10_000 });
    return player;
  });

  await test.step("un joueur coupé pendant une question peut encore répondre", async () => {
    await host.getByRole("button", { name: "Lancer la partie" }).click();
    await expect(alice.getByRole("button", { name: "Canberra", exact: true })).toBeVisible();
    await dropConnection(alice);
    await answer([
      [alice, "Canberra"],
      [bob, "Sydney"],
    ]);
    await expect(alice.getByText("Bonne réponse !")).toBeVisible();
    await expect(host.getByRole("button", { name: "Classement" })).toBeVisible();
  });
});
