import { type Browser, expect, type Page, test } from "@playwright/test";

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

// Chaque joueur répond dans l'ordre : le plus rapide gagne le plus de points.
async function answer(answers: [Page, string][]): Promise<void> {
  for (const [player, choice] of answers) await player.getByRole("button", { name: choice, exact: true }).click();
}

test("un animateur et trois joueurs jouent une partie complète", async ({ browser }) => {
  const host = await newPage(browser);

  await test.step("l'animateur crée son compte", async () => {
    await host.goto("/login");
    await host.getByRole("button", { name: "Pas encore de compte ? En créer un" }).click();
    await host.getByLabel("Nom").fill("Camille");
    await host.getByLabel("Email").fill(`e2e-${String(Date.now())}@quorum.test`);
    await host.getByLabel("Mot de passe").fill("un-mot-de-passe-solide");
    await host.getByRole("button", { name: "Créer le compte" }).click();
    await expect(host.getByRole("heading", { name: "Mes quiz" })).toBeVisible();
  });

  await test.step("il crée un quiz avec un QCM et un vrai/faux", async () => {
    await host.getByRole("link", { name: "Nouveau quiz" }).click();
    await host.getByLabel("Titre").fill("Géographie");
    const first = host.getByRole("group", { name: "Question 1" });
    await first.getByLabel("Énoncé").fill("Quelle est la capitale de l'Australie ?");
    for (const [index, city] of ["Sydney", "Canberra", "Melbourne", "Perth"].entries()) {
      await first.getByLabel(`Choix ${String(index + 1)}`, { exact: true }).fill(city);
    }
    await first.getByLabel("Bonne réponse").nth(1).check();
    await host.getByRole("button", { name: "Ajouter un vrai/faux" }).click();
    const second = host.getByRole("group", { name: "Question 2" });
    await second.getByLabel("Énoncé").fill("La Terre est plate.");
    await second.getByLabel("Bonne réponse").nth(1).check();
    await host.getByRole("button", { name: "Enregistrer" }).click();
    await expect(host.getByRole("heading", { name: "Géographie" })).toBeVisible();
  });

  await host.getByRole("button", { name: "Lancer", exact: true }).click();
  const pin = (await host.getByText(/^\d{6}$/).textContent()) ?? "";

  const [alice, bob, chloe] = await test.step("trois joueurs rejoignent avec le PIN", () =>
    Promise.all(
      ["Alice", "Bob", "Chloé"].map(async (nickname) => {
        const player = await newPage(browser);
        await player.goto(`/play?pin=${pin}`);
        await player.getByLabel("Pseudo").fill(nickname);
        await player.getByRole("button", { name: "Rejoindre" }).click();
        await expect(player.getByText("tu es dans la partie")).toBeVisible();
        return player;
      }),
    ),
  );
  if (!alice || !bob || !chloe) throw new Error("Il manque un joueur");
  await expect(host.getByRole("heading", { name: "3 joueurs" })).toBeVisible();

  await test.step("question 1 : Alice et Bob trouvent, Chloé se trompe", async () => {
    await host.getByRole("button", { name: "Lancer la partie" }).click();
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
