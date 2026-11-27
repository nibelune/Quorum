import { createDb, gameAnswers, gamePlayers, games, gameTeams } from "@quorum/db";
import { type Command, createGame, type GameEvent, reduce } from "@quorum/game-engine";
import { GameId, PlayerId, Question, TeamId } from "@quorum/protocol";
import { asc, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, expect, test } from "vitest";
import { persistGame } from "./persist.ts";
import { createOwner, TEST_DATABASE_URL, TEST_REDIS_URL } from "./testing.ts";

const db = createDb(TEST_DATABASE_URL);
const redis = new Redis(TEST_REDIS_URL);
const deps = { db, redis, logger: pino({ level: "silent" }) };
let ownerId: string;

beforeAll(async () => {
  ownerId = await createOwner(db);
});
afterAll(async () => {
  redis.disconnect();
  await db.$client.end();
});

const T0 = 1_000_000;
const endedAt = new Date("2026-11-27T20:00:00Z");
const question = Question.parse({
  kind: "choice",
  id: crypto.randomUUID(),
  text: "La Terre est ronde.",
  choices: ["Vrai", "Faux"],
  correctIndex: 0,
  durationSec: 10,
});
const [alice, bob, carol] = [1, 2, 3].map(() => PlayerId.parse(crypto.randomUUID()));
const [red, blue] = [1, 2].map(() => TeamId.parse(crypto.randomUUID()));

// Les Rouges (Alice, capitaine, et Bob) trouvent en 2 s ; les Bleus (Carol) se trompent en 5 s.
// La partie est écrite dans Redis comme le fait realtime : l'état final et les fins de question archivées.
async function playGame(): Promise<GameId> {
  if (!alice || !bob || !carol || !red || !blue) throw new Error("Identifiants manquants");
  const commands: Command[] = [
    { type: "join", at: T0, playerId: alice, nickname: "Alice", newTeamId: red, team: { create: "Rouges" } },
    { type: "join", at: T0, playerId: bob, nickname: "Bob", newTeamId: TeamId.parse(crypto.randomUUID()), team: { join: red } },
    { type: "join", at: T0, playerId: carol, nickname: "Carol", newTeamId: blue, team: { create: "Bleus" } },
    { type: "start", at: T0 },
    { type: "answer", at: T0 + 2000, playerId: alice, questionId: question.id, choiceIndex: 0 },
    { type: "answer", at: T0 + 5000, playerId: carol, questionId: question.id, choiceIndex: 1 },
    { type: "next", at: T0 + 6000 },
    { type: "next", at: T0 + 7000 },
  ];
  let state = createGame("123456", [question], "teams", () => 0);
  const events: GameEvent[] = [];
  for (const command of commands) {
    const result = reduce(state, command);
    if (!result.ok) throw new Error(`${command.type} refusée : ${result.error}`);
    state = result.state;
    events.push(...result.events);
  }
  const gameId = GameId.parse(crypto.randomUUID());
  await redis.set(`game:${gameId}:state`, JSON.stringify(state));
  const rounds = events.filter(({ type }) => type === "question_ended").map((event) => JSON.stringify(event));
  await redis.rpush(`game:${gameId}:rounds`, ...rounds);
  await db.insert(games).values({ id: gameId, ownerId, title: "Quiz", mode: "teams", questions: [question] });
  return gameId;
}

async function resultsOf(gameId: GameId) {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  return {
    endedAt: game?.endedAt,
    teams: await db.select().from(gameTeams).where(eq(gameTeams.gameId, gameId)).orderBy(asc(gameTeams.position)),
    players: await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId)).orderBy(asc(gamePlayers.nickname)),
    answers: await db.select().from(gameAnswers).where(eq(gameAnswers.gameId, gameId)).orderBy(asc(gameAnswers.responseMs)),
  };
}

test("enregistre les équipes, les joueurs et les réponses d'une partie terminée", async () => {
  const gameId = await playGame();
  await persistGame(deps, gameId, endedAt);

  expect(await resultsOf(gameId)).toEqual({
    endedAt,
    teams: [
      { gameId, teamId: red, name: "Rouges", score: 900, position: 0 },
      { gameId, teamId: blue, name: "Bleus", score: 0, position: 1 },
    ],
    players: [
      { gameId, playerId: alice, nickname: "Alice", teamId: red },
      { gameId, playerId: bob, nickname: "Bob", teamId: red },
      { gameId, playerId: carol, nickname: "Carol", teamId: blue },
    ],
    answers: [
      { gameId, questionId: question.id, teamId: red, choiceIndex: 0, responseMs: 2000, points: 900 },
      { gameId, questionId: question.id, teamId: blue, choiceIndex: 1, responseMs: 5000, points: 0 },
    ],
  });
});

test("peut être rejouée sans dupliquer les résultats", async () => {
  const gameId = await playGame();
  await persistGame(deps, gameId, endedAt);
  const first = await resultsOf(gameId);
  await persistGame(deps, gameId, endedAt);
  expect(await resultsOf(gameId)).toEqual(first);
});

test("ne fait rien pour une partie que Redis a déjà effacée", async () => {
  const gameId = await playGame();
  await redis.del(`game:${gameId}:state`);
  await persistGame(deps, gameId, endedAt);
  expect(await resultsOf(gameId)).toMatchObject({ endedAt: null, teams: [], players: [], answers: [] });
});
