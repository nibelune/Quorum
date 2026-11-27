import { expect, test } from "@playwright/test";
import { createQuiz, newPage, signUpHost } from "./helpers.ts";

test("un animateur duplique un quiz, puis l'exporte et le réimporte", async ({ browser }) => {
  const host = await newPage(browser);
  await signUpHost(host);
  await createQuiz(host);
  const original = host.getByRole("listitem").filter({ has: host.getByRole("heading", { name: "Géographie", exact: true }) });

  await test.step("la copie apparaît à côté de l'original", async () => {
    await original.getByRole("button", { name: "Dupliquer" }).click();
    await expect(host.getByRole("heading", { name: "Géographie (copie)" })).toBeVisible();
  });

  await test.step("le fichier exporté se réimporte, questions et image comprises", async () => {
    const download = host.waitForEvent("download");
    await original.getByRole("button", { name: "Exporter" }).click();
    await host.getByLabel("Importer un quiz").setInputFiles(await (await download).path());
    await expect(host.getByRole("heading", { name: "Géographie", exact: true })).toHaveCount(2);

    await host.getByRole("link", { name: "Modifier" }).first().click();
    const first = host.getByRole("group", { name: "Question 1" });
    await expect(first.getByLabel("Énoncé")).toHaveValue("Quelle est la capitale de l'Australie ?");
    await expect(first.getByRole("img", { name: "Image de la question 1" })).toBeVisible();
  });

  await test.step("un fichier qui n'est pas un quiz est refusé", async () => {
    await host.getByRole("link", { name: "Retour à mes quiz" }).click();
    await host.getByLabel("Importer un quiz").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from("{}") });
    await expect(host.getByRole("alert")).toHaveText("Ce fichier n'est pas un quiz exporté de Quorum.");
  });
});
