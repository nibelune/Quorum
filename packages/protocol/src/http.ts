import { z } from "zod";
import { GameId, GameMode, ImageUrl, Nickname, Pin, Question, QuestionContent, QuestionId, QuizId, TeamName } from "./domain.ts";

const Title = z.string().trim().min(1).max(120);

export const QuizInput = z.object({
  title: Title,
  // Une nouvelle question n'a pas encore d'identifiant : le serveur lui en attribue un.
  questions: z.array(QuestionContent.safeExtend({ id: QuestionId.optional() })).min(1).max(100),
});
export type QuizInput = z.infer<typeof QuizInput>;

export const Quiz = z.object({ id: QuizId, title: Title, questions: z.array(Question) });
export type Quiz = z.infer<typeof Quiz>;

export const QuizSummary = z.object({
  id: QuizId,
  title: Title,
  questionCount: z.int().positive(),
  updatedAt: z.iso.datetime(),
});
export type QuizSummary = z.infer<typeof QuizSummary>;

export const CreateGameInput = z.object({ quizId: QuizId, mode: GameMode });

export const CreatedGame = z.object({ gameId: GameId, pin: Pin });

export const HostToken = z.object({ token: z.string() });

export const UploadedImage = z.object({ url: ImageUrl });

const Count = z.int().nonnegative();
// Temps de réponse moyen, en millisecondes ; null si personne n'a répondu.
const AverageMs = Count.nullable();

// Une partie terminée, dans la liste de l'animateur.
export const GameSummary = z.object({ id: GameId, title: Title, mode: GameMode, endedAt: z.iso.datetime(), playerCount: Count });
export type GameSummary = z.infer<typeof GameSummary>;

export const GameResults = z.object({
  id: GameId,
  title: Title,
  mode: GameMode,
  endedAt: z.iso.datetime(),
  // Les questions telles qu'elles ont été jouées : `distribution` compte les réponses de chaque choix, dans leur ordre.
  questions: z.array(Question.safeExtend({ distribution: z.array(Count), averageResponseMs: AverageMs })),
  // De la première à la dernière. En solo, chaque joueur forme une équipe d'un membre, à son nom.
  teams: z.array(
    z.object({
      name: TeamName,
      members: z.array(Nickname),
      score: Count,
      rank: z.int().positive(),
      correctCount: Count,
      averageResponseMs: AverageMs,
    }),
  ),
});
export type GameResults = z.infer<typeof GameResults>;
