import { z } from "zod";
import { ChoiceIndex, Nickname, Pin, PlayerId, Question, QuestionId } from "./domain.ts";

const Seq = z.int().nonnegative();
const Count = z.int().nonnegative();
const Score = z.int().nonnegative();

const Player = z.object({ playerId: PlayerId, nickname: Nickname });
export const Standing = z.object({ nickname: Nickname, score: Score });
export type Standing = z.infer<typeof Standing>;

export const ShownQuestion = z.object({
  questionId: QuestionId,
  text: Question.shape.text,
  choices: Question.shape.choices,
  deadline: z.int(),
});
export type ShownQuestion = z.infer<typeof ShownQuestion>;

// Les champs optionnels ne concernent qu'un rôle : `answerCount` l'animateur, `answered` et `you` le joueur.
const Reveal = {
  correctIndex: ChoiceIndex,
  distribution: z.array(Count),
  you: z.object({ points: Score, score: Score }).optional(),
};

const Leaderboard = {
  top: z.array(Standing),
  you: z.object({ rank: z.int().positive(), score: Score }).optional(),
};

const Stage = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("lobby") }),
  z.object({
    phase: z.literal("question"),
    question: ShownQuestion,
    answerCount: Count.optional(),
    answered: z.boolean().optional(),
  }),
  z.object({ phase: z.literal("reveal"), question: ShownQuestion, ...Reveal }),
  z.object({ phase: z.literal("leaderboard"), ...Leaderboard }),
  z.object({ phase: z.literal("ended"), podium: z.array(Standing) }),
]);
export type Stage = z.infer<typeof Stage>;

const View = z.discriminatedUnion("role", [
  z.object({ role: z.literal("host"), pin: Pin, players: z.array(Player), stage: Stage }),
  z.object({ role: z.literal("player"), nickname: Nickname, stage: Stage }),
]);

export const ErrorCode = z.enum([
  "invalid_message",
  "invalid_token",
  "forbidden",
  "rate_limited",
  "game_not_found",
  "nickname_taken",
  "wrong_phase",
  "already_answered",
  "too_late",
  "no_players",
  "kicked",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("player_joined"), seq: Seq, ...Player.shape }),
  z.object({ type: z.literal("player_left"), seq: Seq, playerId: PlayerId }),
  z.object({ type: z.literal("question_started"), seq: Seq, ...ShownQuestion.shape }),
  z.object({ type: z.literal("answer_count"), seq: Seq, count: Count }),
  z.object({ type: z.literal("question_ended"), seq: Seq, ...Reveal }),
  z.object({ type: z.literal("leaderboard"), seq: Seq, ...Leaderboard }),
  z.object({ type: z.literal("game_ended"), seq: Seq, podium: z.array(Standing) }),
  z.object({ type: z.literal("welcome"), token: z.string() }),
  z.object({ type: z.literal("snapshot"), seq: Seq, view: View }),
  z.object({ type: z.literal("answer_received") }),
  z.object({ type: z.literal("error"), code: ErrorCode }),
  z.object({ type: z.literal("reload") }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
