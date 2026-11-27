import { z } from "zod";
import {
  ChoiceIndex,
  Choices,
  GameMode,
  ImageUrl,
  Nickname,
  Order,
  Pin,
  PlayerId,
  QuestionId,
  QuestionKind,
  QuestionText,
  TeamId,
  TeamName,
} from "./domain.ts";

const Seq = z.int().nonnegative();
const Count = z.int().nonnegative();
const Score = z.int().nonnegative();

export const Team = z.object({ teamId: TeamId, name: TeamName });
export type Team = z.infer<typeof Team>;
const Player = z.object({ playerId: PlayerId, nickname: Nickname, team: Team });
// Classements et scores portent sur les équipes : en solo, chaque joueur forme une équipe d'un membre, à son nom.
export const Standing = z.object({ name: TeamName, score: Score });
export type Standing = z.infer<typeof Standing>;

export const ShownQuestion = z.object({
  questionId: QuestionId,
  kind: QuestionKind,
  text: QuestionText,
  choices: Choices,
  imageUrl: ImageUrl.optional(),
  deadline: z.int(),
});
export type ShownQuestion = z.infer<typeof ShownQuestion>;

// Les champs optionnels ne concernent qu'un rôle : `answerCount` l'animateur, `answered`, `teamAnswer` et `you` le joueur.
const Reveal = {
  // La bonne réponse d'un QCM, ou l'ordre attendu d'une remise dans l'ordre. Un sondage n'en a pas.
  correctIndex: ChoiceIndex.optional(),
  correctOrder: Order.optional(),
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
    // Le choix du capitaine, ou son ordre, une fois l'équipe engagée.
    teamAnswer: ChoiceIndex.optional(),
    teamOrder: Order.optional(),
  }),
  z.object({ phase: z.literal("reveal"), question: ShownQuestion, ...Reveal }),
  z.object({ phase: z.literal("leaderboard"), ...Leaderboard }),
  z.object({ phase: z.literal("ended"), podium: z.array(Standing) }),
]);
export type Stage = z.infer<typeof Stage>;

const View = z.discriminatedUnion("role", [
  // Les joueurs de chaque équipe sont dans l'ordre d'arrivée : le premier est le capitaine.
  z.object({ role: z.literal("host"), mode: GameMode, pin: Pin, players: z.array(Player), stage: Stage }),
  z.object({
    role: z.literal("player"),
    mode: GameMode,
    nickname: Nickname,
    team: z.object({ name: TeamName, captain: Nickname }),
    stage: Stage,
  }),
  // Un joueur qui a trouvé la partie par son PIN (`lookup`) et choisit son équipe. En solo, il n'y en a pas à choisir.
  z.object({ role: z.literal("visitor"), mode: GameMode, teams: z.array(Team), canCreateTeam: z.boolean() }),
]);

export const ErrorCode = z.enum([
  "invalid_message",
  "invalid_token",
  "forbidden",
  "rate_limited",
  "game_not_found",
  "nickname_taken",
  "team_name_taken",
  "team_not_found",
  "not_captain",
  "wrong_phase",
  "already_answered",
  "too_late",
  "no_players",
  "kicked",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("player_joined"), seq: Seq, ...Player.shape }),
  // Pour les visiteurs : la liste des équipes à rejoindre se met à jour.
  z.object({ type: z.literal("team_created"), seq: Seq, team: Team }),
  z.object({ type: z.literal("captain_changed"), seq: Seq, captain: Nickname }),
  z.object({ type: z.literal("player_left"), seq: Seq, playerId: PlayerId }),
  z.object({ type: z.literal("question_started"), seq: Seq, ...ShownQuestion.shape }),
  z.object({ type: z.literal("team_answer_locked"), seq: Seq, choiceIndex: ChoiceIndex.optional(), order: Order.optional() }),
  z.object({ type: z.literal("answer_count"), seq: Seq, count: Count }),
  z.object({ type: z.literal("question_ended"), seq: Seq, questionId: QuestionId, ...Reveal }),
  z.object({ type: z.literal("leaderboard"), seq: Seq, ...Leaderboard }),
  z.object({ type: z.literal("game_ended"), seq: Seq, podium: z.array(Standing) }),
  z.object({ type: z.literal("welcome"), token: z.string() }),
  z.object({ type: z.literal("snapshot"), seq: Seq, view: View }),
  z.object({ type: z.literal("answer_received") }),
  z.object({ type: z.literal("pong"), t: z.number(), serverTime: z.number() }),
  z.object({ type: z.literal("error"), code: ErrorCode }),
  z.object({ type: z.literal("reload") }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
