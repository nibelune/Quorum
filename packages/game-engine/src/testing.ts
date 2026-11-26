import { PlayerId, Question } from "@quorum/protocol";
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

export const join = (playerId: PlayerId, nickname: string): Command => ({ type: "join", at: T0, playerId, nickname });

export const answer = (playerId: PlayerId, choiceIndex: number, at = T0, questionId = capital.id): Command => ({
  type: "answer",
  at,
  playerId,
  questionId,
  choiceIndex,
});

export const kick = (playerId: PlayerId): Command => ({ type: "kick", at: T0, playerId });

export const host = (type: "start" | "next" | "end" | "tick", at = T0): Command => ({ type, at });

export function play(...commands: Command[]): { state: GameState; events: GameEvent[] } {
  let state = createGame("123456", [capital, flatEarth]);
  const events: GameEvent[] = [];
  for (const command of commands) {
    const result = reduce(state, command);
    if (!result.ok) throw new Error(`${command.type} refusée : ${result.error}`);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}
