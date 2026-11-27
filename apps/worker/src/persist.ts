import { type Db, gameAnswers, gamePlayers, games, gameTeams } from "@quorum/db";
import { GameEvent, GameState } from "@quorum/game-engine";
import type { GameId } from "@quorum/protocol";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

export interface Deps {
  db: Db;
  redis: Redis;
  logger: Logger;
}

// Copie les résultats d'une partie terminée de Redis vers Postgres (ADR 0014). La tâche peut être rejouée :
// les résultats déjà écrits sont remplacés.
export async function persistGame({ db, redis, logger }: Deps, gameId: GameId, endedAt: Date): Promise<void> {
  const [stateJson, rounds] = await Promise.all([redis.get(`game:${gameId}:state`), redis.lrange(`game:${gameId}:rounds`, 0, -1)]);
  // Redis efface une partie 2 h après sa dernière commande : ses résultats sont alors perdus.
  if (stateJson === null) {
    logger.warn({ gameId }, "partie expirée : résultats perdus");
    return;
  }
  const state = GameState.parse(JSON.parse(stateJson));
  const answers = rounds.flatMap((round) => {
    const event = GameEvent.parse(JSON.parse(round));
    if (event.type !== "question_ended") return [];
    // Une équipe qui n'a pas répondu n'a pas de temps de réponse.
    return Object.entries(event.results).flatMap(([teamId, { points, choiceIndex, responseMs }]) =>
      responseMs === undefined ? [] : [{ gameId, questionId: event.questionId, teamId, choiceIndex: choiceIndex ?? null, responseMs, points }],
    );
  });

  await db.transaction(async (tx) => {
    const [game] = await tx.update(games).set({ endedAt }).where(eq(games.id, gameId)).returning({ id: games.id });
    // Une partie lancée avant que l'API n'enregistre les parties n'a pas de ligne à compléter.
    if (!game) {
      logger.warn({ gameId }, "partie inconnue en base : résultats ignorés");
      return;
    }
    await tx.delete(gameTeams).where(eq(gameTeams.gameId, gameId));
    await tx.delete(gamePlayers).where(eq(gamePlayers.gameId, gameId));
    await tx.delete(gameAnswers).where(eq(gameAnswers.gameId, gameId));
    // Drizzle refuse une insertion vide : une partie terminée dans le lobby n'a ni équipe ni réponse.
    if (state.teams.length > 0) {
      await tx.insert(gameTeams).values(state.teams.map(({ teamId, name, score }, position) => ({ gameId, teamId, name, score, position })));
      await tx.insert(gamePlayers).values(state.players.map(({ playerId, nickname, teamId }) => ({ gameId, playerId, nickname, teamId })));
    }
    if (answers.length > 0) await tx.insert(gameAnswers).values(answers);
    logger.info({ gameId, teams: state.teams.length, answers: answers.length }, "résultats enregistrés");
  });
}
