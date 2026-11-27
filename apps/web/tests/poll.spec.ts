import { expect, test } from "@playwright/test";
import { answer, joinGame, launchGame, newPage, signUpHost } from "./helpers.ts";

test("un sondage montre la répartition des votes, sans bonne réponse ni points", async ({ browser }) => {
  const host = await newPage(browser);
  await signUpHost(host);

  await test.step("l'animateur crée un quiz d'un seul sondage", async () => {
    await host.getByRole("link", { name: "Nouveau quiz" }).click();
    await host.getByLabel("Titre").fill("Préférences");
    await host.getByRole("button", { name: "Ajouter un sondage" }).click();
    await host.getByRole("group", { name: "Question 1" }).getByRole("button", { name: "Supprimer la question" }).click();
    const poll = host.getByRole("group", { name: "Question 1 (sondage)" });
    await poll.getByLabel("Énoncé").fill("Quelle planète préférez-vous ?");
    for (const [index, planet] of ["Mercure", "Mars", "Jupiter", "Saturne"].entries()) {
      await poll.getByLabel(`Choix ${String(index + 1)}`, { exact: true }).fill(planet);
    }
    await expect(poll.getByLabel("Bonne réponse")).toHaveCount(0);
    await host.getByRole("button", { name: "Enregistrer" }).click();
  });

  const pin = await launchGame(host);
  const [alice, bob] = await Promise.all(["Alice", "Bob"].map((nickname) => joinGame(browser, pin, nickname)));
  if (!alice || !bob) throw new Error("Il manque un joueur");

  await test.step("les joueurs votent, sans bonne ni mauvaise réponse", async () => {
    await host.getByRole("button", { name: "Lancer la partie" }).click();
    await answer([
      [alice, "Jupiter"],
      [bob, "Jupiter"],
    ]);
    await expect(alice.getByText("Merci pour ta réponse !")).toBeVisible();
    await expect(host.getByRole("listitem").filter({ hasText: "Jupiter" })).toContainText("2");
  });

  await test.step("les statistiques présentent la question comme un sondage", async () => {
    await host.getByRole("button", { name: "Classement" }).click();
    await host.getByRole("button", { name: "Suivant" }).click();
    await host.getByRole("link", { name: "Voir les statistiques" }).click();
    await expect(host.getByText("Sondage : 2 réponses")).toBeVisible();
  });
});
