import { z } from "zod";

export const GameId = z.uuid().brand<"GameId">();
export type GameId = z.infer<typeof GameId>;

export const PlayerId = z.uuid().brand<"PlayerId">();
export type PlayerId = z.infer<typeof PlayerId>;

export const QuizId = z.uuid().brand<"QuizId">();
export type QuizId = z.infer<typeof QuizId>;

export const QuestionId = z.uuid().brand<"QuestionId">();
export type QuestionId = z.infer<typeof QuestionId>;

export const TeamId = z.uuid().brand<"TeamId">();
export type TeamId = z.infer<typeof TeamId>;

export const Pin = z.string().regex(/^\d{6}$/);

export const Nickname = z.string().trim().min(1).max(20);

export const TeamName = z.string().trim().min(1).max(24);

export const GameMode = z.enum(["solo", "teams"]);
export type GameMode = z.infer<typeof GameMode>;

export const MAX_CHOICES = 4;

export const ChoiceIndex = z.int().min(0).max(MAX_CHOICES - 1);

// Une question vrai/faux est un QCM à deux choix.
export const QuestionContent = z
  .object({
    text: z.string().trim().min(1).max(300),
    choices: z.array(z.string().trim().min(1).max(120)).min(2).max(MAX_CHOICES),
    correctIndex: ChoiceIndex,
    durationSec: z.int().min(5).max(300),
  })
  .refine((question) => question.correctIndex < question.choices.length);

export const Question = QuestionContent.safeExtend({ id: QuestionId });
export type Question = z.infer<typeof Question>;
