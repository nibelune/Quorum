import { z } from "zod";

export const PlayerId = z.uuid().brand<"PlayerId">();
export type PlayerId = z.infer<typeof PlayerId>;

export const QuestionId = z.uuid().brand<"QuestionId">();
export type QuestionId = z.infer<typeof QuestionId>;

export const Pin = z.string().regex(/^\d{6}$/);

export const Nickname = z.string().trim().min(1).max(20);

const MAX_CHOICES = 4;

export const ChoiceIndex = z.int().min(0).max(MAX_CHOICES - 1);

// Une question vrai/faux est un QCM à deux choix.
export const Question = z
  .object({
    id: QuestionId,
    text: z.string().trim().min(1).max(300),
    choices: z.array(z.string().trim().min(1).max(120)).min(2).max(MAX_CHOICES),
    correctIndex: ChoiceIndex,
    durationSec: z.int().min(5).max(300),
  })
  .refine((question) => question.correctIndex < question.choices.length);
export type Question = z.infer<typeof Question>;
