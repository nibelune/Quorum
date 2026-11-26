import { type Browser, expect, type Page } from "@playwright/test";

// Garde une référence aux WebSockets de la page, pour pouvoir couper la connexion dans les tests de reconnexion.
const RECORD_SOCKETS = `{
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      (window.__sockets ??= []).push(this);
    }
  };
}`;

export async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript(RECORD_SOCKETS);
  return context.newPage();
}

export async function dropConnection(page: Page): Promise<void> {
  await page.evaluate("window.__sockets.at(-1).close()");
}

export async function signUpHost(host: Page): Promise<void> {
  await host.goto("/login");
  await host.getByRole("button", { name: "Pas encore de compte ? En créer un" }).click();
  await host.getByLabel("Nom").fill("Camille");
  await host.getByLabel("Email").fill(`e2e-${crypto.randomUUID()}@quorum.test`);
  await host.getByLabel("Mot de passe").fill("un-mot-de-passe-solide");
  await host.getByRole("button", { name: "Créer le compte" }).click();
  await expect(host.getByRole("heading", { name: "Mes quiz" })).toBeVisible();
}

// Un QCM (Canberra) puis un vrai/faux (Faux).
export async function createQuiz(host: Page): Promise<void> {
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
}

export async function launchGame(host: Page, button: "Lancer" | "Lancer en équipes" = "Lancer"): Promise<string> {
  await host.getByRole("button", { name: button, exact: true }).click();
  return (await host.getByText(/^\d{6}$/).textContent()) ?? "";
}

export async function enterPin(browser: Browser, pin: string, nickname: string): Promise<Page> {
  const player = await newPage(browser);
  await player.goto(`/play?pin=${pin}`);
  await player.getByLabel("Pseudo").fill(nickname);
  await player.getByRole("button", { name: "Rejoindre" }).click();
  return player;
}

// En mode équipes, `team` est le nom de l'équipe à créer ou à rejoindre.
export async function joinGame(browser: Browser, pin: string, nickname: string, team?: { create: string } | { join: string }) {
  const player = await enterPin(browser, pin, nickname);
  if (team && "create" in team) {
    await player.getByLabel("Nouvelle équipe").fill(team.create);
    await player.getByRole("button", { name: "Créer l'équipe" }).click();
  }
  if (team && "join" in team) await player.getByRole("button", { name: team.join, exact: true }).click();
  await expect(player.getByText("tu es dans la partie")).toBeVisible();
  return player;
}

// Chaque joueur répond dans l'ordre : le plus rapide gagne le plus de points.
export async function answer(answers: [Page, string][]): Promise<void> {
  for (const [player, choice] of answers) await player.getByRole("button", { name: choice, exact: true }).click();
}
