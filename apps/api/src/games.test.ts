import { GameState } from "@quorum/game-engine";
import { CreatedGame, type GameMode, HostToken, Quiz } from "@quorum/protocol";
import { verifyToken } from "@quorum/protocol/token";
import { Redis } from "ioredis";
import { afterAll, beforeAll, expect, test } from "vitest";
import { signUp, TEST_REDIS_URL, TEST_SECRET, testApp } from "./testing.ts";

const app = testApp();
const redis = new Redis(TEST_REDIS_URL);
let cookie: string;
let quiz: Quiz;

beforeAll(async () => {
  cookie = await signUp(app);
  const question = { text: "Vrai ou faux ?", choices: ["Vrai", "Faux"], correctIndex: 0, durationSec: 10 };
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
  await app.close();
});

async function createGame(as = cookie, mode: GameMode = "solo") {
  return app.inject({ method: "POST", url: "/api/games", headers: { cookie: as }, payload: { quizId: quiz.id, mode } });
}

test.each<GameMode>(["solo", "teams"])("crée une partie en mode %s avec un PIN et écrit son état initial dans Redis", async (mode) => {
  const { gameId, pin } = CreatedGame.parse((await createGame(cookie, mode)).json());
  const state = GameState.parse(JSON.parse((await redis.get(`game:${gameId}:state`)) ?? "null"));
  expect(state).toEqual({ pin, mode, questions: quiz.questions, seq: 0, players: [], teams: [], current: { phase: "lobby" } });
  expect(await redis.get(`pin:${pin}`)).toBe(gameId);
  expect(await redis.ttl(`game:${gameId}:state`)).toBeGreaterThan(0);
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
