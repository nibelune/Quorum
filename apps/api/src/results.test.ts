import { createDb, gameAnswers, gamePlayers, games, gameTeams } from "@quorum/db";
import { CreatedGame, type GameId, GameResults, GameSummary, Quiz } from "@quorum/protocol";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { signUp, TEST_DATABASE_URL, testApp } from "./testing.ts";

const app = testApp();
const db = createDb(TEST_DATABASE_URL);
let cookie: string;
let quiz: Quiz;

beforeAll(async () => {
  cookie = await signUp(app);
  const response = await app.inject({
    method: "POST",
    url: "/api/quizzes",
    headers: { cookie },
    payload: {
      title: "Géographie",
      questions: [
        { text: "Quelle est la capitale de l'Australie ?", choices: ["Sydney", "Canberra", "Melbourne"], correctIndex: 1, durationSec: 20 },
        { text: "La Terre est plate.", choices: ["Vrai", "Faux"], correctIndex: 1, durationSec: 10 },
      ],
    },
  });
  quiz = Quiz.parse(response.json());
});
afterAll(async () => {
  await db.$client.end();
  await app.close();
});

async function launch(): Promise<GameId> {
  const response = await app.inject({ method: "POST", url: "/api/games", headers: { cookie }, payload: { quizId: quiz.id, mode: "teams" } });
  return CreatedGame.parse(response.json()).gameId;
}

// Les Rouges (Alice et Bob) trouvent tout, en 2 s puis 4 s ; les Bleus (Carol) se trompent d'abord en 4 s, puis trouvent en 6 s.
// Les résultats sont écrits comme le fait le worker, sur les questions telles qu'elles ont été jouées, choix mélangés.
async function finish(gameId: GameId) {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  const [capital, flatEarth] = game?.questions ?? [];
  if (!capital || !flatEarth) throw new Error("Questions manquantes");
  const [red, blue] = [crypto.randomUUID(), crypto.randomUUID()];
  const wrong = (capital.correctIndex + 1) % capital.choices.length;
  await db.insert(gameTeams).values([
    { gameId, teamId: red, name: "Rouges", score: 1800, position: 0 },
    { gameId, teamId: blue, name: "Bleus", score: 900, position: 1 },
  ]);
  await db.insert(gamePlayers).values([
    { gameId, playerId: crypto.randomUUID(), nickname: "Bob", teamId: red },
    { gameId, playerId: crypto.randomUUID(), nickname: "Alice", teamId: red },
    { gameId, playerId: crypto.randomUUID(), nickname: "Carol", teamId: blue },
  ]);
  await db.insert(gameAnswers).values([
    { gameId, questionId: capital.id, teamId: red, choiceIndex: capital.correctIndex, responseMs: 2000, points: 900 },
    { gameId, questionId: capital.id, teamId: blue, choiceIndex: wrong, responseMs: 4000, points: 0 },
    { gameId, questionId: flatEarth.id, teamId: red, choiceIndex: flatEarth.correctIndex, responseMs: 4000, points: 900 },
    { gameId, questionId: flatEarth.id, teamId: blue, choiceIndex: flatEarth.correctIndex, responseMs: 6000, points: 900 },
  ]);
  await db.update(games).set({ endedAt: new Date() }).where(eq(games.id, gameId));
  return { capital, flatEarth, wrong };
}

test("liste les parties terminées de l'animateur, avec leur nombre de joueurs", async () => {
  const gameId = await launch();
  await finish(gameId);
  await launch();
  const response = await app.inject({ method: "GET", url: "/api/games", headers: { cookie } });
  // La partie restée dans le lobby n'apparaît pas.
  expect(z.array(GameSummary).parse(response.json())).toMatchObject([{ id: gameId, title: "Géographie", mode: "teams", playerCount: 3 }]);
});

test("donne les résultats d'une partie : classement des équipes et statistiques de chaque question", async () => {
  const gameId = await launch();
  const { capital, flatEarth, wrong } = await finish(gameId);
  const response = await app.inject({ method: "GET", url: `/api/games/${gameId}/results`, headers: { cookie } });
  const results = GameResults.parse(response.json());

  expect(results.teams).toEqual([
    { name: "Rouges", members: ["Alice", "Bob"], score: 1800, rank: 1, correctCount: 2, averageResponseMs: 3000 },
    { name: "Bleus", members: ["Carol"], score: 900, rank: 2, correctCount: 1, averageResponseMs: 5000 },
  ]);
  const capitalDistribution = capital.choices.map((_, index) => (index === capital.correctIndex || index === wrong ? 1 : 0));
  expect(results.questions).toEqual([
    { ...capital, distribution: capitalDistribution, averageResponseMs: 3000 },
    { ...flatEarth, distribution: flatEarth.choices.map((_, index) => (index === flatEarth.correctIndex ? 2 : 0)), averageResponseMs: 5000 },
  ]);
});

test("refuse les résultats d'une partie pas encore terminée", async () => {
  const gameId = await launch();
  expect((await app.inject({ method: "GET", url: `/api/games/${gameId}/results`, headers: { cookie } })).statusCode).toBe(404);
});

test("refuse les résultats d'une partie d'un autre animateur", async () => {
  const gameId = await launch();
  await finish(gameId);
  const other = await signUp(app);
  expect((await app.inject({ method: "GET", url: `/api/games/${gameId}/results`, headers: { cookie: other } })).statusCode).toBe(404);
});
