import {
  ChoiceIndex,
  Nickname,
  Pin,
  PlayerId,
  Question,
  QuestionId,
  ShownQuestion,
  Standing,
} from "@quorum/protocol";
import { z } from "zod";

const Timestamp = z.int();
const Count = z.int().nonnegative();
const Score = z.int().nonnegative();

const Answer = z.object({ playerId: PlayerId, choiceIndex: ChoiceIndex, at: Timestamp });
export type Answer = z.infer<typeof Answer>;

const RoundFields = { index: Count, startedAt: Timestamp, answers: z.array(Answer) };

export const GameState = z.object({
  pin: Pin,
  questions: z.array(Question).min(1),
  seq: Count,
  players: z.array(z.object({ playerId: PlayerId, nickname: Nickname, score: Score })),
  current: z.discriminatedUnion("phase", [
    z.object({ phase: z.literal("lobby") }),
    z.object({ phase: z.literal("question"), ...RoundFields, lastAnswerCount: Count }),
    z.object({ phase: z.literal("reveal"), ...RoundFields }),
    z.object({ phase: z.literal("leaderboard"), index: Count }),
    z.object({ phase: z.literal("ended") }),
  ]),
});
export type GameState = z.infer<typeof GameState>;
export type Player = GameState["players"][number];

export const Command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), at: Timestamp, playerId: PlayerId, nickname: Nickname }),
  z.object({
    type: z.literal("answer"),
    at: Timestamp,
    playerId: PlayerId,
    questionId: QuestionId,
    choiceIndex: ChoiceIndex,
  }),
  z.object({ type: z.literal("kick"), at: Timestamp, playerId: PlayerId }),
  z.object({ type: z.literal("start"), at: Timestamp }),
  z.object({ type: z.literal("next"), at: Timestamp }),
  z.object({ type: z.literal("end"), at: Timestamp }),
  z.object({ type: z.literal("tick"), at: Timestamp }),
]);
export type Command = z.infer<typeof Command>;

const Seq = z.int().positive();

// `results` et `ranks` couvrent tous les joueurs : `project` n'en remet à chacun que sa propre ligne.
export const GameEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("player_joined"), seq: Seq, playerId: PlayerId, nickname: Nickname }),
  z.object({ type: z.literal("player_left"), seq: Seq, playerId: PlayerId }),
  z.object({ type: z.literal("question_started"), seq: Seq, ...ShownQuestion.shape }),
  z.object({ type: z.literal("answer_count"), seq: Seq, count: Count }),
  z.object({
    type: z.literal("question_ended"),
    seq: Seq,
    correctIndex: ChoiceIndex,
    distribution: z.array(Count),
    results: z.record(PlayerId, z.object({ points: Score, score: Score })),
  }),
  z.object({
    type: z.literal("leaderboard"),
    seq: Seq,
    top: z.array(Standing),
    ranks: z.record(PlayerId, z.object({ rank: z.int().positive(), score: Score })),
  }),
  z.object({ type: z.literal("game_ended"), seq: Seq, podium: z.array(Standing) }),
]);
export type GameEvent = z.infer<typeof GameEvent>;

export function createGame(pin: string, questions: Question[]): GameState {
  return { pin, questions, seq: 0, players: [], current: { phase: "lobby" } };
}
