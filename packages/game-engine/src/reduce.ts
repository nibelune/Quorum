import type { ErrorCode } from "@quorum/protocol";
import { deadlineOf, distribution, GRACE_MS, podium, pointsFor, questionAt, rankOf, shownQuestion, top } from "./rules.ts";
import type { Command, GameEvent, GameState } from "./state.ts";

export type ReduceResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: ErrorCode };

type Unsequenced<E> = E extends unknown ? Omit<E, "seq"> : never;
type QuestionRound = Extract<GameState["current"], { phase: "question" }>;

export function reduce(state: GameState, command: Command): ReduceResult {
  const { current } = state;
  switch (command.type) {
    case "join": {
      if (current.phase === "ended") return rejected("wrong_phase");
      const nickname = command.nickname.toLocaleLowerCase();
      if (state.players.some((player) => player.nickname.toLocaleLowerCase() === nickname)) {
        return rejected("nickname_taken");
      }
      const { playerId } = command;
      return emit(
        { ...state, players: [...state.players, { playerId, nickname: command.nickname, score: 0 }] },
        { type: "player_joined", playerId, nickname: command.nickname },
      );
    }
    case "start":
      if (current.phase !== "lobby") return rejected("wrong_phase");
      if (state.players.length === 0) return rejected("no_players");
      return startQuestion(state, 0, command.at);
    case "answer":
      return answer(state, command);
    case "tick": {
      if (current.phase !== "question") return withoutEvent(state);
      const count = current.answers.length;
      if (command.at > deadlineOf(questionAt(state, current.index), current.startedAt) + GRACE_MS) {
        return endQuestion(state, current);
      }
      if (count === current.lastAnswerCount) return withoutEvent(state);
      return emit({ ...state, current: { ...current, lastAnswerCount: count } }, { type: "answer_count", count });
    }
    case "next":
      return next(state, command.at);
    case "kick": {
      if (current.phase === "ended") return rejected("wrong_phase");
      const { playerId } = command;
      if (!state.players.some((player) => player.playerId === playerId)) return withoutEvent(state);
      return emit(
        {
          ...state,
          players: state.players.filter((player) => player.playerId !== playerId),
          current:
            current.phase === "question"
              ? { ...current, answers: current.answers.filter((answer) => answer.playerId !== playerId) }
              : current,
        },
        { type: "player_left", playerId },
      );
    }
    case "end":
      if (current.phase === "ended") return rejected("wrong_phase");
      return endGame(state);
  }
}

function answer(state: GameState, command: Extract<Command, { type: "answer" }>): ReduceResult {
  const { current } = state;
  const { playerId } = command;
  if (!state.players.some((player) => player.playerId === playerId)) return rejected("kicked");
  if (current.phase !== "question") return rejected("too_late");
  const question = questionAt(state, current.index);
  if (question.id !== command.questionId || command.at > deadlineOf(question, current.startedAt) + GRACE_MS) {
    return rejected("too_late");
  }
  if (command.choiceIndex >= question.choices.length) return rejected("invalid_message");
  if (current.answers.some((answer) => answer.playerId === playerId)) return rejected("already_answered");

  const round = { ...current, answers: [...current.answers, { playerId, choiceIndex: command.choiceIndex, at: command.at }] };
  const answered = { ...state, current: round };
  return round.answers.length === state.players.length ? endQuestion(answered, round) : withoutEvent(answered);
}

function next(state: GameState, at: number): ReduceResult {
  const { current } = state;
  switch (current.phase) {
    case "question":
      return endQuestion(state, current);
    case "reveal":
      return emit(
        { ...state, current: { phase: "leaderboard", index: current.index } },
        {
          type: "leaderboard",
          top: top(state.players),
          ranks: Object.fromEntries(
            state.players.map((player) => [player.playerId, { rank: rankOf(state.players, player), score: player.score }]),
          ),
        },
      );
    case "leaderboard":
      return current.index + 1 < state.questions.length ? startQuestion(state, current.index + 1, at) : endGame(state);
    case "lobby":
    case "ended":
      return rejected("wrong_phase");
  }
}

function startQuestion(state: GameState, index: number, at: number): ReduceResult {
  return emit(
    { ...state, current: { phase: "question", index, startedAt: at, answers: [], lastAnswerCount: 0 } },
    { type: "question_started", ...shownQuestion(questionAt(state, index), at) },
  );
}

function endQuestion(state: GameState, round: QuestionRound): ReduceResult {
  const question = questionAt(state, round.index);
  const scored = state.players.map((player) => {
    const points = pointsFor(question, round.startedAt, round.answers.find((a) => a.playerId === player.playerId));
    return { player: { ...player, score: player.score + points }, points };
  });
  return emit(
    {
      ...state,
      players: scored.map(({ player }) => player),
      current: { phase: "reveal", index: round.index, startedAt: round.startedAt, answers: round.answers },
    },
    {
      type: "question_ended",
      correctIndex: question.correctIndex,
      distribution: distribution(question, round.answers),
      results: Object.fromEntries(scored.map(({ player, points }) => [player.playerId, { points, score: player.score }])),
    },
  );
}

function endGame(state: GameState): ReduceResult {
  return emit({ ...state, current: { phase: "ended" } }, { type: "game_ended", podium: podium(state.players) });
}

function emit(state: GameState, event: Unsequenced<GameEvent>): ReduceResult {
  const seq = state.seq + 1;
  return { ok: true, state: { ...state, seq }, events: [{ ...event, seq }] };
}

function withoutEvent(state: GameState): ReduceResult {
  return { ok: true, state, events: [] };
}

function rejected(error: ErrorCode): ReduceResult {
  return { ok: false, error };
}
