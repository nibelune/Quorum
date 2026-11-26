import { z } from "zod";
import { GameId, GameMode, ImageUrl, Pin, Question, QuestionContent, QuestionId, QuizId } from "./domain.ts";

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
