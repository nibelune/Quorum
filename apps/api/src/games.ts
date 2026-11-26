import { randomInt } from "node:crypto";
import { quizzes } from "@quorum/db";
import { createGame, shuffleChoices } from "@quorum/game-engine";
import { CreatedGame, CreateGameInput, GameId, HostToken } from "@quorum/protocol";
import { signToken } from "@quorum/protocol/token";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { Deps } from "./app.ts";

const GAME_TTL_SECONDS = 2 * 60 * 60;
const HOST_TOKEN_TTL_MS = 15 * 60 * 1000;

export function gameRoutes(app: FastifyInstance, { db, redis, sessionSecret }: Deps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.post("/api/games", { schema: { body: CreateGameInput, response: { 201: CreatedGame, 404: z.null() } } }, async (request, reply) => {
    const [quiz] = await db
      .select({ questions: quizzes.questions })
      .from(quizzes)
      .where(and(eq(quizzes.id, request.body.quizId), eq(quizzes.ownerId, request.userId)));
    if (!quiz) return reply.code(404).send(null);

    const gameId = GameId.parse(crypto.randomUUID());
    const pin = await reservePin(redis, gameId);
    const questions = quiz.questions.map((question) => shuffleChoices(question, Math.random));
    await redis
      .multi()
      .set(`game:${gameId}:state`, JSON.stringify(createGame(pin, questions, request.body.mode)), "EX", GAME_TTL_SECONDS)
      .set(`game:${gameId}:owner`, request.userId, "EX", GAME_TTL_SECONDS)
      .exec();
    return reply.code(201).send({ gameId, pin });
  });

  api.post(
    "/api/games/:id/host-token",
    { schema: { params: z.object({ id: GameId }), response: { 200: HostToken, 404: z.null() } } },
    async (request, reply) => {
      const gameId = request.params.id;
      if ((await redis.get(`game:${gameId}:owner`)) !== request.userId) return reply.code(404).send(null);
      return { token: signToken({ role: "host", gameId, exp: Date.now() + HOST_TOKEN_TTL_MS }, sessionSecret) };
    },
  );
}

// Un PIN libre est trouvé du premier coup tant que les parties en cours se comptent en milliers.
async function reservePin(redis: Redis, gameId: GameId): Promise<string> {
  for (;;) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (await redis.set(`pin:${pin}`, gameId, "EX", GAME_TTL_SECONDS, "NX")) return pin;
  }
}
