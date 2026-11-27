import type { ErrorCode, TeamId } from "@quorum/protocol";
import {
  captainOf,
  correctIndexOf,
  deadlineOf,
  distribution,
  GRACE_MS,
  podium,
  pointsFor,
  questionAt,
  rankOf,
  shownQuestion,
  teamRef,
  top,
} from "./rules.ts";
import type { Command, GameEvent, GameState, Team } from "./state.ts";

export type ReduceResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: ErrorCode };

type Unsequenced<E> = E extends unknown ? Omit<E, "seq"> : never;
type QuestionRound = Extract<GameState["current"], { phase: "question" }>;
type JoinCommand = Extract<Command, { type: "join" }>;

export function reduce(state: GameState, command: Command): ReduceResult {
  const { current } = state;
  switch (command.type) {
    case "join":
      return join(state, command);
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
    case "kick":
      return kick(state, command);
    case "end":
      if (current.phase === "ended") return rejected("wrong_phase");
      return endGame(state);
  }
}

// L'équipe d'un joueur dont le `join` est accepté : celle qu'il a choisie, ou celle qu'il crée. `realtime` l'inscrit dans son jeton.
export function joinedTeamId({ team, newTeamId }: JoinCommand): TeamId {
  return team && "join" in team ? team.join : newTeamId;
}

function join(state: GameState, command: JoinCommand): ReduceResult {
  const { nickname, team } = command;
  if (state.current.phase === "ended") return rejected("wrong_phase");
  if (isTaken(state.players.map((player) => player.nickname), nickname)) return rejected("nickname_taken");
  // En mode équipes, le joueur choisit son équipe. En solo, il en crée une à son nom.
  if ((state.mode === "teams") !== (team !== undefined)) return rejected("invalid_message");
  const teamId = joinedTeamId(command);
  if (team && "join" in team) {
    const joined = state.teams.find((existing) => existing.teamId === teamId);
    if (!joined) return rejected("team_not_found");
    return addPlayer(state, command, joined);
  }
  if (team && state.current.phase !== "lobby") return rejected("wrong_phase");
  const name = team?.create ?? nickname;
  if (isTaken(state.teams.map((existing) => existing.name), name)) return rejected("team_name_taken");
  const created = { teamId, name, score: 0 };
  // Les visiteurs suivent les équipes créées, pour rejoindre la leur. En solo, l'équipe d'un membre reste implicite.
  const announcement = team ? [{ type: "team_created", team: teamRef(created) } as const] : [];
  return addPlayer({ ...state, teams: [...state.teams, created] }, command, created, ...announcement);
}

function addPlayer(
  state: GameState,
  { playerId, nickname }: JoinCommand,
  team: Team,
  ...announcement: Unsequenced<GameEvent>[]
): ReduceResult {
  return emit(
    { ...state, players: [...state.players, { playerId, nickname, teamId: team.teamId }] },
    ...announcement,
    { type: "player_joined", playerId, nickname, team: teamRef(team) },
  );
}

// Pseudos et noms d'équipe sont uniques sans tenir compte de la casse.
function isTaken(names: string[], name: string): boolean {
  const lowered = name.toLocaleLowerCase();
  return names.some((existing) => existing.toLocaleLowerCase() === lowered);
}

function answer(state: GameState, command: Extract<Command, { type: "answer" }>): ReduceResult {
  const { current } = state;
  const player = state.players.find(({ playerId }) => playerId === command.playerId);
  if (!player) return rejected("kicked");
  if (current.phase !== "question") return rejected("too_late");
  const question = questionAt(state, current.index);
  if (question.id !== command.questionId || command.at > deadlineOf(question, current.startedAt) + GRACE_MS) {
    return rejected("too_late");
  }
  if (command.choiceIndex >= question.choices.length) return rejected("invalid_message");
  const { playerId, teamId } = player;
  if (captainOf(state, teamId)?.playerId !== playerId) return rejected("not_captain");
  if (current.answers.some((answer) => answer.teamId === teamId)) return rejected("already_answered");

  const { choiceIndex } = command;
  const round = { ...current, answers: [...current.answers, { playerId, teamId, choiceIndex, at: command.at }] };
  const answered = { ...state, current: round };
  if (round.answers.length === state.teams.length) return endQuestion(answered, round);
  // Les coéquipiers voient aussitôt le choix de leur capitaine. Une équipe d'un membre, comme en solo, n'a personne à prévenir.
  const hasTeammates = state.players.filter((member) => member.teamId === teamId).length > 1;
  return hasTeammates ? emit(answered, { type: "team_answer_locked", teamId, choiceIndex }) : withoutEvent(answered);
}

function kick(state: GameState, command: Extract<Command, { type: "kick" }>): ReduceResult {
  const { current } = state;
  if (current.phase === "ended") return rejected("wrong_phase");
  const player = state.players.find(({ playerId }) => playerId === command.playerId);
  if (!player) return withoutEvent(state);
  const { playerId, teamId } = player;
  const players = state.players.filter((other) => other.playerId !== playerId);
  const successor = players.find((other) => other.teamId === teamId);
  const kicked = {
    ...state,
    players,
    // Une équipe vide disparaît.
    teams: successor ? state.teams : state.teams.filter((team) => team.teamId !== teamId),
    current:
      current.phase === "question"
        ? { ...current, answers: current.answers.filter((answer) => answer.playerId !== playerId) }
        : current,
  };
  // La réponse d'un capitaine exclu part avec lui : son successeur, le membre arrivé le plus tôt, répond à sa place.
  if (successor && captainOf(state, teamId)?.playerId === playerId) {
    return emit(kicked, { type: "player_left", playerId }, { type: "captain_changed", teamId, captain: successor.nickname });
  }
  return emit(kicked, { type: "player_left", playerId });
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
          top: top(state.teams),
          ranks: Object.fromEntries(
            state.teams.map((team) => [team.teamId, { rank: rankOf(state.teams, team), score: team.score }]),
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
  const scored = state.teams.map((team) => {
    const answer = round.answers.find(({ teamId }) => teamId === team.teamId);
    const points = pointsFor(question, round.startedAt, answer);
    const given = answer && { choiceIndex: answer.choiceIndex, responseMs: Math.max(answer.at - round.startedAt, 0) };
    return { team: { ...team, score: team.score + points }, points, given };
  });
  return emit(
    {
      ...state,
      teams: scored.map(({ team }) => team),
      current: { phase: "reveal", index: round.index, startedAt: round.startedAt, answers: round.answers },
    },
    {
      type: "question_ended",
      questionId: question.id,
      correctIndex: correctIndexOf(question),
      distribution: distribution(question, round.answers),
      results: Object.fromEntries(scored.map(({ team, points, given }) => [team.teamId, { points, score: team.score, ...given }])),
    },
  );
}

function endGame(state: GameState): ReduceResult {
  return emit({ ...state, current: { phase: "ended" } }, { type: "game_ended", podium: podium(state.teams) });
}

function emit(state: GameState, ...events: Unsequenced<GameEvent>[]): ReduceResult {
  return {
    ok: true,
    state: { ...state, seq: state.seq + events.length },
    events: events.map((event, index) => ({ ...event, seq: state.seq + index + 1 })),
  };
}

function withoutEvent(state: GameState): ReduceResult {
  return { ok: true, state, events: [] };
}

function rejected(error: ErrorCode): ReduceResult {
  return { ok: false, error };
}
