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

// Images envoyées à l'API (ADR 0013). Pas de SVG : il peut contenir du script.
export const ImageType = z.enum(["image/jpeg", "image/png", "image/webp"]);
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
// Le nom d'une image stockée : un UUID suivi du sous-type, qui redonne son Content-Type.
export const ImageKey = z.string().regex(/^[0-9a-f-]{36}\.(jpeg|png|webp)$/);
// Seules les URL délivrées par l'API sont acceptées dans une question, jamais celles d'un site tiers.
export const ImageUrl = z.templateLiteral(["/api/images/", ImageKey]);

export const QuestionText = z.string().trim().min(1).max(300);
export const Choices = z.array(z.string().trim().min(1).max(120)).min(2).max(MAX_CHOICES);
const common = { text: QuestionText, durationSec: z.int().min(5).max(300), imageUrl: ImageUrl.optional() };

// Les types de question (ADR 0015). Une question vrai/faux est un QCM à deux choix ; un sondage n'a pas de bonne réponse
// et ne rapporte aucun point.
export const MultipleChoiceQuestion = z
  .object({ kind: z.literal("choice"), ...common, choices: Choices, correctIndex: ChoiceIndex })
  .refine((question) => question.correctIndex < question.choices.length);
export const PollQuestion = z.object({ kind: z.literal("poll"), ...common, choices: Choices });

// Une suite de positions dans `choices`, du premier élément au dernier.
export const Order = z.array(ChoiceIndex).min(3).max(MAX_CHOICES);
const isOrderOf = (order: number[], choices: string[]) =>
  order.length === choices.length && choices.every((_, index) => order.includes(index));

// Une remise dans l'ordre : `correctOrder` est l'ordre attendu. L'auteur saisit les éléments dans cet ordre,
// et chaque partie les mélange.
export const OrderQuestion = z
  .object({ kind: z.literal("order"), ...common, choices: Choices.min(3), correctOrder: Order })
  .refine((question) => isOrderOf(question.correctOrder, question.choices));

export const QuestionKind = z.enum(["choice", "poll", "order"]);
export type QuestionKind = z.infer<typeof QuestionKind>;

const withId = { id: QuestionId };
export const Question = z.discriminatedUnion("kind", [
  MultipleChoiceQuestion.safeExtend(withId),
  PollQuestion.safeExtend(withId),
  OrderQuestion.safeExtend(withId),
]);
export type Question = z.infer<typeof Question>;
