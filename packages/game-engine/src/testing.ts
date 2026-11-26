import { type GameMode, PlayerId, Question, TeamId } from "@quorum/protocol";
import { reduce } from "./reduce.ts";
import { type Command, createGame, type GameEvent, type GameState } from "./state.ts";

export const T0 = 1_000_000;

export const capital = Question.parse({
  id: crypto.randomUUID(),
  text: "Quelle est la capitale de l'Australie ?",
  choices: ["Sydney", "Canberra", "Melbourne"],
  correctIndex: 1,
  durationSec: 20,
});

export const flatEarth = Question.parse({
  id: crypto.randomUUID(),
  text: "La Terre est plate.",
  choices: ["Vrai", "Faux"],
  correctIndex: 1,
  durationSec: 10,
});

export const alice = PlayerId.parse(crypto.randomUUID());
export const bob = PlayerId.parse(crypto.randomUUID());
export const carol = PlayerId.parse(crypto.randomUUID());
export const dave = PlayerId.parse(crypto.randomUUID());

export const red = TeamId.parse(crypto.randomUUID());
export const blue = TeamId.parse(crypto.randomUUID());
export const green = TeamId.parse(crypto.randomUUID());

// En solo, chaque joueur crée son équipe : dans les tests, elle reprend son identifiant.
export const soloTeam = (playerId: PlayerId): TeamId => TeamId.parse(playerId);

export const join = (playerId: PlayerId, nickname: string): Command => ({
  type: "join",
  at: T0,
  playerId,
  nickname,
  newTeamId: soloTeam(playerId),
});

export const createTeam = (playerId: PlayerId, nickname: string, teamId: TeamId, name: string): Command => ({
  type: "join",
  at: T0,
  playerId,
  nickname,
  newTeamId: teamId,
  team: { create: name },
});

export const joinTeam = (playerId: PlayerId, nickname: string, teamId: TeamId): Command => ({
  type: "join",
  at: T0,
  playerId,
  nickname,
  newTeamId: TeamId.parse(crypto.randomUUID()),
  team: { join: teamId },
});

export const answer = (playerId: PlayerId, choiceIndex: number, at = T0, questionId = capital.id): Command => ({
  type: "answer",
  at,
  playerId,
  questionId,
  choiceIndex,
});

export const kick = (playerId: PlayerId): Command => ({ type: "kick", at: T0, playerId });

export const host = (type: "start" | "next" | "end" | "tick", at = T0): Command => ({ type, at });

export interface Game {
  state: GameState;
  events: GameEvent[];
}

export const play = (...commands: Command[]): Game => replay("solo", commands);

export const playTeams = (...commands: Command[]): Game => replay("teams", commands);

function replay(mode: GameMode, commands: Command[]): Game {
  let state = createGame("123456", [capital, flatEarth], mode);
  const events: GameEvent[] = [];
  for (const command of commands) {
    const result = reduce(state, command);
    if (!result.ok) throw new Error(`${command.type} refusée : ${result.error}`);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}
