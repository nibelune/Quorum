import { z } from "zod";
import {
  GameId,
  GameMode,
  ImageUrl,
  MultipleChoiceQuestion,
  Nickname,
  Pin,
  PollQuestion,
  Question,
  QuestionId,
  QuizId,
  TeamName,
} from "./domain.ts";

const Title = z.string().trim().min(1).max(120);

// Une nouvelle question n'a pas encore d'identifiant : le serveur lui en attribue un.
const draftId = { id: QuestionId.optional() };

export const QuizInput = z.object({
  title: Title,
  questions: z
    .array(z.discriminatedUnion("kind", [MultipleChoiceQuestion.safeExtend(draftId), PollQuestion.safeExtend(draftId)]))
    .min(1)
    .max(100),
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

// Les questions telles qu'elles ont été jouées : `distribution` compte les réponses de chaque choix, dans leur ordre.
const stats = { id: QuestionId, distribution: z.array(Count), averageResponseMs: AverageMs };

// Une partie terminée, dans la liste de l'animateur.
export const GameSummary = z.object({ id: GameId, title: Title, mode: GameMode, endedAt: z.iso.datetime(), playerCount: Count });
export type GameSummary = z.infer<typeof GameSummary>;

export const GameResults = z.object({
  id: GameId,
  title: Title,
  mode: GameMode,
  endedAt: z.iso.datetime(),
  questions: z.array(z.discriminatedUnion("kind", [MultipleChoiceQuestion.safeExtend(stats), PollQuestion.safeExtend(stats)])),
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
