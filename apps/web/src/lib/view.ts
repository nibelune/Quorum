import type { ServerMessage, Stage } from "@quorum/protocol";

export type View = Extract<ServerMessage, { type: "snapshot" }>["view"];

export interface ViewState {
  view: View | null;
  seq: number;
}

// Met à jour la vue avec un message du serveur. Un événement déjà couvert par le dernier `seq` reçu est ignoré :
// juste après un `snapshot`, la socket peut recevoir des événements que celui-ci contient déjà.
export function reduceView(state: ViewState, message: ServerMessage): ViewState {
  if (message.type === "snapshot") return { view: message.view, seq: message.seq };
  // Le visiteur accepté change d'identité : sa vue ne vaut plus, le snapshot qui suit la remplace.
  if (message.type === "welcome") return { view: null, seq: 0 };
  const { view } = state;
  if (!view) return state;
  if ("seq" in message && message.seq <= state.seq) return state;
  const seq = "seq" in message ? message.seq : state.seq;
  // Le visiteur ne suit que les équipes créées, pour pouvoir rejoindre la sienne.
  if (view.role === "visitor") {
    if (message.type !== "team_created") return state;
    return { seq, view: { ...view, teams: [...view.teams, message.team] } };
  }
  const { stage } = view;

  switch (message.type) {
    case "player_joined": {
      if (view.role !== "host") return state;
      const { playerId, nickname, team } = message;
      return { seq, view: { ...view, players: [...view.players, { playerId, nickname, team }] } };
    }
    case "player_left":
      if (view.role !== "host") return state;
      return { seq, view: { ...view, players: view.players.filter(({ playerId }) => playerId !== message.playerId) } };
    case "captain_changed": {
      if (view.role !== "player") return state;
      // La réponse du capitaine exclu est partie avec lui : son successeur répond à son tour.
      const next = stage.phase === "question" ? { ...stage, answered: false, teamAnswer: undefined } : stage;
      return { seq, view: { ...view, team: { ...view.team, captain: message.captain }, stage: next } };
    }
    case "team_answer_locked":
      if (stage.phase !== "question") return { seq, view };
      return { seq, view: { ...view, stage: { ...stage, answered: true, teamAnswer: message.choiceIndex } } };
    case "question_started": {
      const { questionId, text, choices, imageUrl, deadline } = message;
      const question = { questionId, text, choices, imageUrl, deadline };
      const next: Stage =
        view.role === "host" ? { phase: "question", question, answerCount: 0 } : { phase: "question", question, answered: false };
      return { seq, view: { ...view, stage: next } };
    }
    case "answer_count":
      if (stage.phase !== "question") return { seq, view };
      return { seq, view: { ...view, stage: { ...stage, answerCount: message.count } } };
    case "answer_received":
      if (stage.phase !== "question") return state;
      return { seq, view: { ...view, stage: { ...stage, answered: true } } };
    // Une réponse renvoyée après une coupure, déjà enregistrée par le serveur.
    case "error":
      if (message.code !== "already_answered" || stage.phase !== "question") return state;
      return { seq, view: { ...view, stage: { ...stage, answered: true } } };
    case "question_ended": {
      if (stage.phase !== "question") return { seq, view };
      const { correctIndex, distribution, you } = message;
      return { seq, view: { ...view, stage: { phase: "reveal", question: stage.question, correctIndex, distribution, you } } };
    }
    case "leaderboard":
      return { seq, view: { ...view, stage: { phase: "leaderboard", top: message.top, you: message.you } } };
    case "game_ended":
      return { seq, view: { ...view, stage: { phase: "ended", podium: message.podium } } };
    case "team_created":
    case "pong":
    case "reload":
      return state;
  }
}
