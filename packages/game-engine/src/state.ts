import {
  ChoiceIndex,
  GameMode,
  Nickname,
  Pin,
  PlayerId,
  Question,
  QuestionId,
  ShownQuestion,
  Standing,
  Team as TeamRef,
  TeamChoice,
  TeamId,
} from "@quorum/protocol";
import { z } from "zod";
import { shuffleChoices } from "./rules.ts";

const Timestamp = z.int();
const Count = z.int().nonnegative();
const Score = z.int().nonnegative();

const Answer = z.object({ playerId: PlayerId, teamId: TeamId, choiceIndex: ChoiceIndex, at: Timestamp });
export type Answer = z.infer<typeof Answer>;

const RoundFields = { index: Count, startedAt: Timestamp, answers: z.array(Answer) };

export const GameState = z.object({
  pin: Pin,
  mode: GameMode,
  questions: z.array(Question).min(1),
  seq: Count,
  // Par ordre d'arrivée : le capitaine d'une équipe est son membre arrivé le plus tôt.
  players: z.array(z.object({ playerId: PlayerId, nickname: Nickname, teamId: TeamId })),
  // Les scores et les classements portent sur les équipes. En solo, chaque joueur forme une équipe d'un membre, à son nom :
  // il en est le capitaine, et le reste des règles s'applique sans cas particulier.
  teams: z.array(TeamRef.safeExtend({ score: Score })),
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
export type Team = GameState["teams"][number];

export const Command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    at: Timestamp,
    playerId: PlayerId,
    nickname: Nickname,
    // Identifiant de l'équipe si le joueur en crée une (toujours en solo) : le moteur ne tire pas d'aléa.
    newTeamId: TeamId,
    team: TeamChoice.optional(),
  }),
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

// `results` et `ranks` couvrent toutes les équipes : `project` ne remet à chaque joueur que la ligne de la sienne.
export const GameEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("player_joined"), seq: Seq, playerId: PlayerId, nickname: Nickname, team: TeamRef }),
  z.object({ type: z.literal("player_left"), seq: Seq, playerId: PlayerId }),
  z.object({ type: z.literal("team_created"), seq: Seq, team: TeamRef }),
  z.object({ type: z.literal("captain_changed"), seq: Seq, teamId: TeamId, captain: Nickname }),
  z.object({ type: z.literal("team_answer_locked"), seq: Seq, teamId: TeamId, choiceIndex: ChoiceIndex }),
  z.object({ type: z.literal("question_started"), seq: Seq, ...ShownQuestion.shape }),
  z.object({ type: z.literal("answer_count"), seq: Seq, count: Count }),
  // Le choix et le temps de réponse de chaque équipe servent aux statistiques : chaque fin de question est archivée (ADR 0014).
  z.object({
    type: z.literal("question_ended"),
    seq: Seq,
    questionId: QuestionId,
    // Absente pour un sondage.
    correctIndex: ChoiceIndex.optional(),
    distribution: z.array(Count),
    results: z.record(
      TeamId,
      z.object({ points: Score, score: Score, choiceIndex: ChoiceIndex.optional(), responseMs: Count.optional() }),
    ),
  }),
  z.object({
    type: z.literal("leaderboard"),
    seq: Seq,
    top: z.array(Standing),
    ranks: z.record(TeamId, z.object({ rank: z.int().positive(), score: Score })),
  }),
  z.object({ type: z.literal("game_ended"), seq: Seq, podium: z.array(Standing) }),
]);
export type GameEvent = z.infer<typeof GameEvent>;

// Les choix de chaque question sont mélangés une fois pour la partie : l'ordre de l'auteur ne se retrouve pas à l'écran.
export function createGame(pin: string, questions: Question[], mode: GameMode, random: () => number): GameState {
  const shuffled = questions.map((question) => shuffleChoices(question, random));
  return { pin, mode, questions: shuffled, seq: 0, players: [], teams: [], current: { phase: "lobby" } };
}
