import { createDb, games } from "@quorum/db";
import { GameState } from "@quorum/game-engine";
import { CreatedGame, type GameMode, HostToken, Quiz } from "@quorum/protocol";
import { verifyToken } from "@quorum/protocol/token";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { afterAll, beforeAll, expect, test } from "vitest";
import { signUp, TEST_DATABASE_URL, TEST_REDIS_URL, TEST_SECRET, testApp } from "./testing.ts";

const app = testApp();
const redis = new Redis(TEST_REDIS_URL);
const db = createDb(TEST_DATABASE_URL);
let cookie: string;
let quiz: Quiz;

beforeAll(async () => {
  cookie = await signUp(app);
  const question = { kind: "choice" as const, text: "Vrai ou faux ?", choices: ["Vrai", "Faux"], correctIndex: 0, durationSec: 10 };
  const response = await app.inject({
    method: "POST",
    url: "/api/quizzes",
    headers: { cookie },
    payload: { title: "Quiz", questions: [question] },
  });
  quiz = Quiz.parse(response.json());
});
afterAll(async () => {
  redis.disconnect();
  await db.$client.end();
  await app.close();
});

async function createGame(as = cookie, mode: GameMode = "solo") {
  return app.inject({ method: "POST", url: "/api/games", headers: { cookie: as }, payload: { quizId: quiz.id, mode } });
}

test.each<GameMode>(["solo", "teams"])("crée une partie en mode %s avec un PIN et écrit son état initial dans Redis", async (mode) => {
  const { gameId, pin } = CreatedGame.parse((await createGame(cookie, mode)).json());
  const state = GameState.parse(JSON.parse((await redis.get(`game:${gameId}:state`)) ?? "null"));
  // Les questions, mélangées, sont vérifiées à part.
  expect(state).toMatchObject({ pin, mode, seq: 0, players: [], teams: [], current: { phase: "lobby" } });
  // La partie est aussi enregistrée en base, avec les questions telles qu'elles seront jouées.
  const [row] = await db.select().from(games).where(eq(games.id, gameId));
  expect(row).toMatchObject({ quizId: quiz.id, title: "Quiz", mode, questions: state.questions, endedAt: null });
  expect(await redis.get(`pin:${pin}`)).toBe(gameId);
  expect(await redis.ttl(`game:${gameId}:state`)).toBeGreaterThan(0);
});

test("mélange les choix de chaque question, en gardant la bonne réponse", async () => {
  const { gameId } = CreatedGame.parse((await createGame()).json());
  const { questions } = GameState.parse(JSON.parse((await redis.get(`game:${gameId}:state`)) ?? "null"));
  const [question] = questions;
  if (question?.kind !== "choice") throw new Error("QCM attendu");
  expect(question.choices.toSorted()).toEqual(["Faux", "Vrai"]);
  expect(question.choices[question.correctIndex]).toBe("Vrai");
});

test("refuse de lancer le quiz d'un autre animateur", async () => {
  expect((await createGame(await signUp(app))).statusCode).toBe(404);
});

test("délivre au propriétaire de la partie un jeton animateur", async () => {
  const { gameId } = CreatedGame.parse((await createGame()).json());
  const response = await app.inject({ method: "POST", url: `/api/games/${gameId}/host-token`, headers: { cookie } });
  const { token } = HostToken.parse(response.json());
  expect(verifyToken(token, TEST_SECRET, Date.now())).toMatchObject({ role: "host", gameId });
});

test("refuse le jeton animateur à un autre animateur", async () => {
  const { gameId } = CreatedGame.parse((await createGame()).json());
  const other = await signUp(app);
  const response = await app.inject({ method: "POST", url: `/api/games/${gameId}/host-token`, headers: { cookie: other } });
  expect(response.statusCode).toBe(404);
});
