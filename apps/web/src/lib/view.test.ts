import { PlayerId, QuestionId, type ServerMessage, type Stage } from "@quorum/protocol";
import { describe, expect, test } from "vitest";
import { reduceView, type View, type ViewState } from "./view.ts";

const alice = PlayerId.parse(crypto.randomUUID());
const questionId = QuestionId.parse(crypto.randomUUID());
const question = { questionId, text: "La Terre est ronde.", choices: ["Vrai", "Faux"], deadline: 1_000 };

const host: View = { role: "host", pin: "123456", players: [], stage: { phase: "lobby" } };
const player: View = { role: "player", nickname: "Alice", stage: { phase: "lobby" } };
const at = (view: View, seq = 1): ViewState => ({ view, seq });
const inQuestion = (view: View): View =>
  view.role === "host"
    ? { ...view, stage: { phase: "question", question, answerCount: 0 } }
    : { ...view, stage: { phase: "question", question, answered: false } };

test("un snapshot remplace la vue et le seq", () => {
  expect(reduceView({ view: null, seq: 0 }, { type: "snapshot", seq: 7, view: host })).toEqual({ view: host, seq: 7 });
});

test("un événement déjà couvert par le seq reçu est ignoré", () => {
  const state = at(host, 5);
  expect(reduceView(state, { type: "player_joined", seq: 5, playerId: alice, nickname: "Alice" })).toBe(state);
});

describe("animateur", () => {
  test("voit les joueurs arriver et partir", () => {
    const joined = reduceView(at(host), { type: "player_joined", seq: 2, playerId: alice, nickname: "Alice" });
    expect(joined.view).toMatchObject({ players: [{ playerId: alice, nickname: "Alice" }] });
    expect(reduceView(joined, { type: "player_left", seq: 3, playerId: alice }).view).toMatchObject({ players: [] });
  });

  test("suit le nombre de réponses pendant une question", () => {
    const started = reduceView(at(host), { type: "question_started", seq: 2, ...question });
    expect(started.view?.stage).toEqual({ phase: "question", question, answerCount: 0 });
    expect(reduceView(started, { type: "answer_count", seq: 3, count: 4 }).view?.stage).toMatchObject({ answerCount: 4 });
  });
});

describe("joueur", () => {
  test("une question commence sans réponse, puis la réponse est confirmée", () => {
    const started = reduceView(at(player), { type: "question_started", seq: 2, ...question });
    expect(started.view?.stage).toEqual({ phase: "question", question, answered: false });
    expect(reduceView(started, { type: "answer_received" }).view?.stage).toMatchObject({ answered: true });
  });

  test("la révélation garde la question et donne le résultat du joueur", () => {
    const you = { points: 950, score: 950 };
    const ended = reduceView(at(inQuestion(player)), { type: "question_ended", seq: 2, correctIndex: 0, distribution: [1, 0], you });
    expect(ended.view?.stage).toEqual({ phase: "reveal", question, correctIndex: 0, distribution: [1, 0], you });
  });

  test.each<[Stage["phase"], ServerMessage]>([
    ["leaderboard", { type: "leaderboard", seq: 2, top: [{ nickname: "Alice", score: 950 }], you: { rank: 1, score: 950 } }],
    ["ended", { type: "game_ended", seq: 2, podium: [{ nickname: "Alice", score: 950 }] }],
  ])("passe à l'étape %s", (phase, message) => {
    expect(reduceView(at(player), message).view?.stage.phase).toBe(phase);
  });
});
