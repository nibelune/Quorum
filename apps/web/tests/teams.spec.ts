import { expect, test } from "@playwright/test";
import { answer, createQuiz, enterPin, joinGame, launchGame, newPage, signUpHost } from "./helpers.ts";

test("deux équipes jouent : seul le capitaine répond, et ses coéquipiers voient son choix", async ({ browser }) => {
  const host = await newPage(browser);
  await signUpHost(host);
  await createQuiz(host);
  const pin = await launchGame(host, "Lancer en équipes");

  const [alice, bob, chloe] = await test.step("Bob voit apparaître l'équipe qu'Alice vient de créer, et la rejoint", async () => {
    const waiting = await enterPin(browser, pin, "Bob");
    await expect(waiting.getByText("Aucune équipe pour l'instant.")).toBeVisible();
    const captain = await joinGame(browser, pin, "Alice", { create: "Rouges" });
    await waiting.getByRole("button", { name: "Rouges", exact: true }).click();
    await expect(waiting.getByText("Alice répond pour l'équipe.")).toBeVisible();
    return [captain, waiting, await joinGame(browser, pin, "Chloé", { create: "Bleus" })];
  });
  await expect(host.getByRole("heading", { name: "2 équipes · 3 joueurs" })).toBeVisible();
  await expect(host.getByRole("region", { name: "Rouges" })).toContainText("Alice (capitaine)");

  await test.step("question 1 : Bob suit le choix de sa capitaine, les Rouges trouvent", async () => {
    await host.getByRole("button", { name: "Lancer la partie" }).click();
    await expect(bob.getByText("Alice répond pour l'équipe : discutez-en !")).toBeVisible();
    await expect(bob.getByRole("button", { name: "Canberra" })).toHaveCount(0);
    await answer([[alice, "Canberra"]]);
    await expect(bob.getByRole("listitem").filter({ hasText: "Choix de l'équipe" })).toContainText("Canberra");
    await answer([[chloe, "Sydney"]]);
    await expect(bob.getByText("Bonne réponse !")).toBeVisible();
    await expect(chloe.getByText("Raté…")).toBeVisible();
    await host.getByRole("button", { name: "Classement" }).click();
    await expect(host.getByRole("listitem")).toHaveText([/Rouges/, /Bleus/]);
    await expect(bob.getByText("Ton équipe est 1re")).toBeVisible();
  });

  await test.step("question 2, puis le podium des équipes", async () => {
    await host.getByRole("button", { name: "Suivant" }).click();
    await answer([
      [alice, "Faux"],
      [chloe, "Vrai"],
    ]);
    await host.getByRole("button", { name: "Classement" }).click();
    await host.getByRole("button", { name: "Suivant" }).click();
    await expect(host.getByRole("heading", { name: "Podium" })).toBeVisible();
    await expect(host.getByRole("listitem")).toHaveText([/Rouges/, /Bleus/]);
  });
});
