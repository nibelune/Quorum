import type { PlayerId, ServerMessage, Stage, TeamId } from "@quorum/protocol";
import { captainOf, distribution, podium, pointsFor, questionAt, rankOf, shownQuestion, teamRef, top } from "./rules.ts";
import type { GameEvent, GameState, Team } from "./state.ts";

// Un visiteur a saisi le PIN sans avoir encore rejoint la partie : il ne suit que les équipes, pour choisir la sienne.
export type Recipient = { role: "host" } | { role: "player"; playerId: PlayerId; teamId: TeamId } | { role: "visitor" };

export function project(event: GameEvent, to: Recipient): ServerMessage | null {
  switch (event.type) {
    case "player_joined":
    case "answer_count":
      return to.role === "host" ? event : null;
    case "team_created":
      return to.role === "visitor" ? event : null;
    case "player_left":
      if (to.role === "host") return event;
      return to.role === "player" && to.playerId === event.playerId ? { type: "error", code: "kicked" } : null;
    case "captain_changed":
    case "team_answer_locked": {
      const { teamId, ...message } = event;
      return to.role === "player" && to.teamId === teamId ? message : null;
    }
    case "question_started":
    case "game_ended":
      return to.role === "visitor" ? null : event;
    case "question_ended": {
      if (to.role === "visitor") return null;
      const { results, ...message } = event;
      if (to.role === "host") return message;
      const result = results[to.teamId];
      return { ...message, you: result && { points: result.points, score: result.score } };
    }
    case "leaderboard": {
      if (to.role === "visitor") return null;
      const { ranks, ...message } = event;
      return to.role === "host" ? message : { ...message, you: ranks[to.teamId] };
    }
  }
}

export function snapshot(state: GameState, to: Recipient): ServerMessage {
  const { mode, seq } = state;
  switch (to.role) {
    case "visitor": {
      // En solo, il n'y a pas d'équipe à choisir : chaque joueur crée la sienne.
      const choosing = mode === "teams";
      const teams = choosing ? state.teams.map(teamRef) : [];
      return { type: "snapshot", seq, view: { role: "visitor", mode, teams, canCreateTeam: choosing && state.current.phase === "lobby" } };
    }
    case "host": {
      // Regroupés par équipe, chacune dans l'ordre d'arrivée : le premier membre est le capitaine.
      const players = state.teams.flatMap((team) =>
        state.players
          .filter(({ teamId }) => teamId === team.teamId)
          .map(({ playerId, nickname }) => ({ playerId, nickname, team: teamRef(team) })),
      );
      return { type: "snapshot", seq, view: { role: "host", mode, pin: state.pin, players, stage: stage(state) } };
    }
    case "player": {
      const player = state.players.find(({ playerId }) => playerId === to.playerId);
      const team = state.teams.find(({ teamId }) => teamId === player?.teamId);
      const captain = player && captainOf(state, player.teamId);
      if (!player || !team || !captain) return { type: "error", code: "kicked" };
      const view = { role: "player", mode, nickname: player.nickname, team: { name: team.name, captain: captain.nickname } } as const;
      return { type: "snapshot", seq, view: { ...view, stage: stage(state, team) } };
    }
  }
}

// `team` est l'équipe du joueur destinataire, absente pour l'animateur.
function stage(state: GameState, team?: Team): Stage {
  const { current } = state;
  switch (current.phase) {
    case "lobby":
      return { phase: "lobby" };
    case "question": {
      const question = shownQuestion(questionAt(state, current.index), current.startedAt);
      if (!team) return { phase: "question", question, answerCount: current.answers.length };
      const answer = current.answers.find(({ teamId }) => teamId === team.teamId);
      return { phase: "question", question, answered: answer !== undefined, teamAnswer: answer?.choiceIndex };
    }
    case "reveal": {
      const question = questionAt(state, current.index);
      const answer = current.answers.find(({ teamId }) => teamId === team?.teamId);
      return {
        phase: "reveal",
        question: shownQuestion(question, current.startedAt),
        correctIndex: question.correctIndex,
        distribution: distribution(question, current.answers),
        you: team && { points: pointsFor(question, current.startedAt, answer), score: team.score },
      };
    }
    case "leaderboard":
      return { phase: "leaderboard", top: top(state.teams), you: team && { rank: rankOf(state.teams, team), score: team.score } };
    case "ended":
      return { phase: "ended", podium: podium(state.teams) };
  }
}
