import { PlayerId, QuestionId, type ServerMessage, type ShownQuestion, type Stage, TeamId } from "@quorum/protocol";
import { describe, expect, test } from "vitest";
import { reduceView, type View, type ViewState } from "./view.ts";

const alice = PlayerId.parse(crypto.randomUUID());
const bob = PlayerId.parse(crypto.randomUUID());
const reds = { teamId: TeamId.parse(crypto.randomUUID()), name: "Rouges" };
const questionId = QuestionId.parse(crypto.randomUUID());
const question: ShownQuestion = {
  questionId,
  text: "La Terre est ronde.",
  choices: ["Vrai", "Faux"],
  imageUrl: `/api/images/${crypto.randomUUID()}.png`,
  deadline: 1_000,
};

type JoinedView = Exclude<View, { role: "visitor" }>;
const host: JoinedView = { role: "host", mode: "teams", pin: "123456", teams: [], players: [], stage: { phase: "lobby" } };
const player: JoinedView = { role: "player", mode: "teams", nickname: "Bob", team: { name: "Rouges", captain: "Alice" }, stage: { phase: "lobby" } };
const at = (view: View, seq = 1): ViewState => ({ view, seq });
const inQuestion = (view: JoinedView): View =>
  view.role === "host"
    ? { ...view, stage: { phase: "question", question, answerCount: 0 } }
    : { ...view, stage: { phase: "question", question, answered: false } };
const stageOf = ({ view }: ViewState) => (view && "stage" in view ? view.stage : null);
const joined = (playerId: PlayerId, nickname: string, seq: number): ServerMessage => ({
  type: "player_joined",
  seq,
  playerId,
  nickname,
  team: reds,
});

test("un snapshot remplace la vue et le seq", () => {
  expect(reduceView({ view: null, seq: 0 }, { type: "snapshot", seq: 7, view: host })).toEqual({ view: host, seq: 7 });
});

test("un événement déjà couvert par le seq reçu est ignoré", () => {
  const state = at(host, 5);
  expect(reduceView(state, joined(alice, "Alice", 5))).toBe(state);
});

test("un visiteur voit les équipes de la partie, puis celles qui se créent", () => {
  const visiting = reduceView({ view: null, seq: 0 }, { type: "game_info", mode: "teams", teams: [], canCreateTeam: true });
  const created = reduceView(visiting, { type: "team_created", seq: 1, team: reds });
  expect(created.view).toEqual({ role: "visitor", mode: "teams", teams: [reds], canCreateTeam: true });
});

describe("animateur", () => {
  test("voit les joueurs arriver dans leur équipe, et une équipe vide disparaître", () => {
    const withAlice = reduceView(at(host), joined(alice, "Alice", 2));
    expect(withAlice.view).toMatchObject({ teams: [reds], players: [{ playerId: alice, nickname: "Alice", teamId: reds.teamId }] });
    const withBob = reduceView(withAlice, joined(bob, "Bob", 3));
    expect(withBob.view).toMatchObject({ teams: [reds] });
    const withoutAlice = reduceView(withBob, { type: "player_left", seq: 4, playerId: alice });
    expect(withoutAlice.view).toMatchObject({ teams: [reds], players: [{ playerId: bob }] });
    expect(reduceView(withoutAlice, { type: "player_left", seq: 5, playerId: bob }).view).toMatchObject({ teams: [], players: [] });
  });

  test("suit le nombre de réponses pendant une question", () => {
    const started = reduceView(at(host), { type: "question_started", seq: 2, ...question });
    expect(stageOf(started)).toEqual({ phase: "question", question, answerCount: 0 });
    expect(stageOf(reduceView(started, { type: "answer_count", seq: 3, count: 4 }))).toMatchObject({ answerCount: 4 });
  });
});

describe("joueur", () => {
  test("une question commence sans réponse, puis la réponse est confirmée", () => {
    const started = reduceView(at(player), { type: "question_started", seq: 2, ...question });
    expect(stageOf(started)).toEqual({ phase: "question", question, answered: false });
    expect(stageOf(reduceView(started, { type: "answer_received" }))).toMatchObject({ answered: true });
  });

  test("une réponse déjà enregistrée (renvoyée après une coupure) compte comme envoyée", () => {
    const state = at(inQuestion(player));
    expect(stageOf(reduceView(state, { type: "error", code: "already_answered" }))).toMatchObject({ answered: true });
  });

  test("voit le choix de son capitaine", () => {
    const locked = reduceView(at(inQuestion(player)), { type: "team_answer_locked", seq: 2, choiceIndex: 1 });
    expect(stageOf(locked)).toMatchObject({ answered: true, teamAnswer: 1 });
  });

  test("quand le capitaine est exclu, son successeur prend la main et répond à son tour", () => {
    const locked = reduceView(at(inQuestion(player)), { type: "team_answer_locked", seq: 2, choiceIndex: 1 });
    const changed = reduceView(locked, { type: "captain_changed", seq: 3, captain: "Bob" });
    expect(changed.view).toMatchObject({ team: { captain: "Bob" }, stage: { answered: false, teamAnswer: undefined } });
  });

  test("la révélation garde la question et donne le résultat de son équipe", () => {
    const you = { points: 950, score: 950 };
    const ended = reduceView(at(inQuestion(player)), { type: "question_ended", seq: 2, correctIndex: 0, distribution: [1, 0], you });
    expect(stageOf(ended)).toEqual({ phase: "reveal", question, correctIndex: 0, distribution: [1, 0], you });
  });

  test.each<[Stage["phase"], ServerMessage]>([
    ["leaderboard", { type: "leaderboard", seq: 2, top: [{ name: "Rouges", score: 950 }], you: { rank: 1, score: 950 } }],
    ["ended", { type: "game_ended", seq: 2, podium: [{ name: "Rouges", score: 950 }] }],
  ])("passe à l'étape %s", (phase, message) => {
    expect(stageOf(reduceView(at(player), message))?.phase).toBe(phase);
  });
});
