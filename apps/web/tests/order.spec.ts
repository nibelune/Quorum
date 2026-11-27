import { expect, test } from "@playwright/test";
import { joinGame, launchGame, newPage, signUpHost } from "./helpers.ts";

const PLANETS = ["Mercure", "Vénus", "Terre", "Mars"];

test("une remise dans l'ordre rapporte des points au seul ordre exact", async ({ browser }) => {
  const host = await newPage(browser);
  await signUpHost(host);

  await test.step("l'animateur saisit les éléments dans le bon ordre", async () => {
    await host.getByRole("link", { name: "Nouveau quiz" }).click();
    await host.getByLabel("Titre").fill("Système solaire");
    await host.getByRole("button", { name: "Ajouter une remise dans l'ordre" }).click();
    await host.getByRole("group", { name: "Question 1" }).getByRole("button", { name: "Supprimer la question" }).click();
    const question = host.getByRole("group", { name: "Question 1 (remise dans l'ordre)" });
    await question.getByLabel("Énoncé").fill("Rangez ces planètes de la plus proche à la plus lointaine du Soleil.");
    await question.getByRole("button", { name: "Ajouter un élément" }).click();
    for (const [index, planet] of PLANETS.entries()) await question.getByLabel(`Élément ${String(index + 1)}`).fill(planet);
    await host.getByRole("button", { name: "Enregistrer" }).click();
  });

  const pin = await launchGame(host);
  const [alice, bob] = await Promise.all(["Alice", "Bob"].map((nickname) => joinGame(browser, pin, nickname)));
  if (!alice || !bob) throw new Error("Il manque un joueur");

  await test.step("Alice range les planètes dans le bon ordre, Bob se trompe", async () => {
    await host.getByRole("button", { name: "Lancer la partie" }).click();
    for (const planet of PLANETS) await alice.getByRole("button", { name: planet }).click();
    await alice.getByRole("button", { name: "Valider" }).click();
    for (const planet of ["Vénus", "Mercure", "Terre", "Mars"]) await bob.getByRole("button", { name: planet }).click();
    await bob.getByRole("button", { name: "Valider" }).click();
    await expect(alice.getByText("Bonne réponse !")).toBeVisible();
    await expect(bob.getByText("Raté…")).toBeVisible();
    // L'écran projeté révèle l'ordre attendu, numéroté.
    await expect(host.getByRole("listitem")).toHaveText([/1\.\s*Mercure/, /2\.\s*Vénus/, /3\.\s*Terre/, /4\.\s*Mars/]);
  });

  await test.step("les statistiques comptent une bonne réponse sur deux", async () => {
    await host.getByRole("button", { name: "Classement" }).click();
    await host.getByRole("button", { name: "Suivant" }).click();
    await host.getByRole("link", { name: "Voir les statistiques" }).click();
    await expect(host.getByText("Bonnes réponses : 1 / 2")).toBeVisible();
  });
});
