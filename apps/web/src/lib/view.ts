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
  const { view } = state;
  if (!view) return state;
  if ("seq" in message && message.seq <= state.seq) return state;
  const seq = "seq" in message ? message.seq : state.seq;
  const { stage } = view;

  switch (message.type) {
    case "player_joined":
      if (view.role !== "host") return state;
      return { seq, view: { ...view, players: [...view.players, { playerId: message.playerId, nickname: message.nickname }] } };
    case "player_left":
      if (view.role !== "host") return state;
      return { seq, view: { ...view, players: view.players.filter(({ playerId }) => playerId !== message.playerId) } };
    case "question_started": {
      const { questionId, text, choices, deadline } = message;
      const question = { questionId, text, choices, deadline };
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
    case "welcome":
    case "reload":
      return state;
  }
}
