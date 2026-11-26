import type { PlayerId, ServerMessage, Stage } from "@quorum/protocol";
import { distribution, podium, pointsFor, questionAt, rankOf, shownQuestion, top } from "./rules.ts";
import type { GameEvent, GameState } from "./state.ts";

export type Recipient = { role: "host" } | { role: "player"; playerId: PlayerId };

export function project(event: GameEvent, to: Recipient): ServerMessage | null {
  switch (event.type) {
    case "player_joined":
    case "answer_count":
      return to.role === "host" ? event : null;
    case "player_left":
      if (to.role === "host") return event;
      return to.playerId === event.playerId ? { type: "error", code: "kicked" } : null;
    case "question_started":
    case "game_ended":
      return event;
    case "question_ended": {
      const { results, ...message } = event;
      return to.role === "host" ? message : { ...message, you: results[to.playerId] };
    }
    case "leaderboard": {
      const { ranks, ...message } = event;
      return to.role === "host" ? message : { ...message, you: ranks[to.playerId] };
    }
  }
}

export function snapshot(state: GameState, to: Recipient): ServerMessage {
  if (to.role === "host") {
    const players = state.players.map(({ playerId, nickname }) => ({ playerId, nickname }));
    return { type: "snapshot", seq: state.seq, view: { role: "host", pin: state.pin, players, stage: stage(state, to) } };
  }
  const player = state.players.find(({ playerId }) => playerId === to.playerId);
  if (!player) return { type: "error", code: "kicked" };
  return { type: "snapshot", seq: state.seq, view: { role: "player", nickname: player.nickname, stage: stage(state, to) } };
}

function stage(state: GameState, to: Recipient): Stage {
  const { current } = state;
  const player = to.role === "player" ? state.players.find(({ playerId }) => playerId === to.playerId) : undefined;
  switch (current.phase) {
    case "lobby":
      return { phase: "lobby" };
    case "question": {
      const question = shownQuestion(questionAt(state, current.index), current.startedAt);
      return player
        ? { phase: "question", question, answered: current.answers.some(({ playerId }) => playerId === player.playerId) }
        : { phase: "question", question, answerCount: current.answers.length };
    }
    case "reveal": {
      const question = questionAt(state, current.index);
      const answer = current.answers.find(({ playerId }) => playerId === player?.playerId);
      return {
        phase: "reveal",
        question: shownQuestion(question, current.startedAt),
        correctIndex: question.correctIndex,
        distribution: distribution(question, current.answers),
        you: player && { points: pointsFor(question, current.startedAt, answer), score: player.score },
      };
    }
    case "leaderboard":
      return {
        phase: "leaderboard",
        top: top(state.players),
        you: player && { rank: rankOf(state.players, player), score: player.score },
      };
    case "ended":
      return { phase: "ended", podium: podium(state.players) };
  }
}
