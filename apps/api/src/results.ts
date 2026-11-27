import { gameAnswers, gamePlayers, games, gameTeams } from "@quorum/db";
import { GameId, GameResults, GameSummary } from "@quorum/protocol";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "./app.ts";

// Les résultats des parties terminées, enregistrés par le worker (ADR 0014).
export function resultRoutes(app: FastifyInstance, { db }: Deps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get("/api/games", { schema: { response: { 200: z.array(GameSummary) } } }, async (request) => {
    const rows = await db
      .select({
        id: games.id,
        title: games.title,
        mode: games.mode,
        endedAt: games.endedAt,
        playerCount: sql<number>`(select count(*)::int from ${gamePlayers} where ${gamePlayers.gameId} = ${games.id})`,
      })
      .from(games)
      .where(eq(games.ownerId, request.userId))
      .orderBy(desc(games.endedAt));
    // Seules les parties terminées ont des résultats.
    return rows.flatMap(({ endedAt, ...game }) => (endedAt ? [{ ...game, endedAt: endedAt.toISOString() }] : []));
  });

  api.get(
    "/api/games/:id/results",
    { schema: { params: z.object({ id: GameId }), response: { 200: GameResults, 404: z.null() } } },
    async (request, reply) => {
      const gameId = request.params.id;
      const [game] = await db
        .select()
        .from(games)
        .where(and(eq(games.id, gameId), eq(games.ownerId, request.userId)));
      // Tant que le worker n'a pas enregistré ses résultats, une partie n'en a pas.
      if (!game?.endedAt) return reply.code(404).send(null);

      const [answers, teams, players] = await Promise.all([
        db
          .select({
            questionId: gameAnswers.questionId,
            choiceIndex: gameAnswers.choiceIndex,
            count: sql<number>`count(*)::int`,
            totalMs: sql<number>`sum(${gameAnswers.responseMs})::int`,
          })
          .from(gameAnswers)
          .where(eq(gameAnswers.gameId, gameId))
          .groupBy(gameAnswers.questionId, gameAnswers.choiceIndex),
        // Une réponse rapporte des points si et seulement si elle est juste. Le rang suit les règles de la partie :
        // à score égal, même rang, et l'équipe créée la plus tôt passe devant.
        db
          .select({
            teamId: gameTeams.teamId,
            name: gameTeams.name,
            score: gameTeams.score,
            rank: sql<number>`(rank() over (order by ${gameTeams.score} desc))::int`,
            correctCount: sql<number>`(count(*) filter (where ${gameAnswers.points} > 0))::int`,
            averageResponseMs: sql<number | null>`round(avg(${gameAnswers.responseMs}))::int`,
          })
          .from(gameTeams)
          .leftJoin(gameAnswers, and(eq(gameAnswers.gameId, gameTeams.gameId), eq(gameAnswers.teamId, gameTeams.teamId)))
          .where(eq(gameTeams.gameId, gameId))
          .groupBy(gameTeams.teamId, gameTeams.name, gameTeams.score, gameTeams.position)
          .orderBy(desc(gameTeams.score), asc(gameTeams.position)),
        db
          .select({ teamId: gamePlayers.teamId, nickname: gamePlayers.nickname })
          .from(gamePlayers)
          .where(eq(gamePlayers.gameId, gameId))
          .orderBy(asc(gamePlayers.nickname)),
      ]);

      return {
        id: game.id,
        title: game.title,
        mode: game.mode,
        endedAt: game.endedAt.toISOString(),
        questions: game.questions.map((question) => {
          const rows = answers.filter(({ questionId }) => questionId === question.id);
          const answered = rows.reduce((total, { count }) => total + count, 0);
          const totalMs = rows.reduce((total, row) => total + row.totalMs, 0);
          return {
            ...question,
            distribution: question.choices.map((_, index) => rows.find(({ choiceIndex }) => choiceIndex === index)?.count ?? 0),
            averageResponseMs: answered === 0 ? null : Math.round(totalMs / answered),
          };
        }),
        teams: teams.map(({ teamId, ...team }) => ({
          ...team,
          members: players.filter((player) => player.teamId === teamId).map(({ nickname }) => nickname),
        })),
      };
    },
  );
}
