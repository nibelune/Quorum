import type { PlayerId, ServerMessage, TeamId } from "@quorum/protocol";
import { describe, expect, test } from "vitest";
import { project, type Recipient, snapshot } from "./project.ts";
import type { GameEvent } from "./state.ts";
import {
  alice,
  answer,
  blue,
  bob,
  capital,
  carol,
  createTeam,
  host,
  join,
  joinTeam,
  play,
  playTeams,
  red,
  soloTeam,
  T0,
} from "./testing.ts";

const toHost: Recipient = { role: "host" };
const toVisitor: Recipient = { role: "visitor" };
const toPlayer = (playerId: PlayerId, teamId: TeamId = soloTeam(playerId)): Recipient => ({ role: "player", playerId, teamId });
const viewOf = (message: ServerMessage) => (message.type === "snapshot" ? message.view : message);

describe("project", () => {
  test.each<GameEvent>([
    { type: "player_joined", seq: 1, playerId: alice, nickname: "Alice", team: { teamId: red, name: "Rouges" } },
    { type: "answer_count", seq: 4, count: 1 },
  ])("$type ne va qu'à l'animateur", (event) => {
    expect(project(event, toHost)).toBe(event);
    expect(project(event, toPlayer(alice))).toBeNull();
    expect(project(event, toVisitor)).toBeNull();
  });

  test("team_created ne va qu'aux visiteurs, qui choisissent leur équipe", () => {
    const event: GameEvent = { type: "team_created", seq: 1, team: { teamId: red, name: "Rouges" } };
    expect(project(event, toVisitor)).toBe(event);
    expect(project(event, toHost)).toBeNull();
    expect(project(event, toPlayer(alice))).toBeNull();
  });

  test("player_left va à l'animateur et prévient le joueur exclu", () => {
    const event: GameEvent = { type: "player_left", seq: 4, playerId: alice };
    expect(project(event, toHost)).toBe(event);
    expect(project(event, toPlayer(alice))).toEqual({ type: "error", code: "kicked" });
    expect(project(event, toPlayer(bob))).toBeNull();
  });

  test.each<Extract<GameEvent, { teamId: TeamId }>>([
    { type: "team_answer_locked", seq: 5, teamId: red, choiceIndex: 1 },
    { type: "captain_changed", seq: 5, teamId: red, captain: "Bob" },
  ])("$type ne va qu'aux membres de l'équipe concernée", (event) => {
    const { teamId, ...message } = event;
    expect(project(event, toPlayer(bob, teamId))).toStrictEqual(message);
    expect(project(event, toPlayer(carol, blue))).toBeNull();
    expect(project(event, toHost)).toBeNull();
  });

  test.each<GameEvent>([
    { type: "question_started", seq: 3, questionId: capital.id, text: capital.text, choices: capital.choices, deadline: T0 },
    { type: "game_ended", seq: 9, podium: [{ name: "Alice", score: 1000 }] },
  ])("$type va tel quel à l'animateur et aux joueurs", (event) => {
    expect(project(event, toHost)).toBe(event);
    expect(project(event, toPlayer(alice))).toBe(event);
    expect(project(event, toVisitor)).toBeNull();
  });

  test("question_ended ne donne à chaque joueur que les points et le score de son équipe", () => {
    const event: GameEvent = {
      type: "question_ended",
      seq: 4,
      questionId: capital.id,
      correctIndex: 1,
      distribution: [1, 1, 0],
      results: { [red]: { points: 1000, score: 1000, choiceIndex: 1, responseMs: 0 }, [blue]: { points: 0, score: 0 } },
    };
    const shared = { type: "question_ended", seq: 4, questionId: capital.id, correctIndex: 1, distribution: [1, 1, 0] };
    expect(project(event, toHost)).toStrictEqual(shared);
    expect(project(event, toPlayer(bob, red))).toStrictEqual({ ...shared, you: { points: 1000, score: 1000 } });
    expect(project(event, toPlayer(carol))).toEqual(shared);
  });

  test("leaderboard ne donne à chaque joueur que le rang de son équipe", () => {
    const top = [{ name: "Rouges", score: 1000 }];
    const event: GameEvent = { type: "leaderboard", seq: 5, top, ranks: { [red]: { rank: 1, score: 1000 } } };
    expect(project(event, toHost)).toStrictEqual({ type: "leaderboard", seq: 5, top });
    expect(project(event, toPlayer(bob, red))).toStrictEqual({ type: "leaderboard", seq: 5, top, you: { rank: 1, score: 1000 } });
  });
});

describe("snapshot", () => {
  const lobby = [join(alice, "Alice"), join(bob, "Bob")];
  const question = [...lobby, host("start"), answer(alice, 1)];
  const shown = { questionId: capital.id, text: capital.text, choices: capital.choices, deadline: T0 + 20_000 };

  test("donne à l'animateur le mode, le PIN, les équipes et les joueurs", () => {
    expect(snapshot(play(...lobby).state, toHost)).toStrictEqual({
      type: "snapshot",
      seq: 2,
      view: {
        role: "host",
        mode: "solo",
        pin: "123456",
        players: [
          { playerId: alice, nickname: "Alice", team: { teamId: soloTeam(alice), name: "Alice" } },
          { playerId: bob, nickname: "Bob", team: { teamId: soloTeam(bob), name: "Bob" } },
        ],
        stage: { phase: "lobby" },
      },
    });
  });

  test("pendant une question, donne le nombre de réponses à l'animateur et à chaque joueur la réponse de son équipe", () => {
    const { state } = play(...question);
    expect(snapshot(state, toHost)).toMatchObject({ view: { stage: { phase: "question", question: shown, answerCount: 1 } } });
    expect(snapshot(state, toPlayer(alice))).toStrictEqual({
      type: "snapshot",
      seq: 3,
      view: {
        role: "player",
        mode: "solo",
        nickname: "Alice",
        team: { name: "Alice", captain: "Alice" },
        stage: { phase: "question", question: shown, answered: true, teamAnswer: 1 },
      },
    });
    expect(snapshot(state, toPlayer(bob))).toMatchObject({ view: { stage: { answered: false } } });
  });

  test("pendant la révélation, donne à chaque joueur son résultat", () => {
    const { state } = play(...question, answer(bob, 0));
    expect(snapshot(state, toPlayer(alice))).toMatchObject({
      view: {
        stage: {
          phase: "reveal",
          question: shown,
          correctIndex: 1,
          distribution: [1, 1, 0],
          you: { points: 1000, score: 1000 },
        },
      },
    });
  });

  test("pendant le classement, donne à chaque joueur son rang", () => {
    const { state } = play(...question, answer(bob, 0), host("next"));
    expect(snapshot(state, toPlayer(bob))).toMatchObject({
      view: { stage: { phase: "leaderboard", top: [{ name: "Alice" }, { name: "Bob" }], you: { rank: 2, score: 0 } } },
    });
  });

  test("à la fin, donne le podium", () => {
    expect(snapshot(play(...lobby, host("end")).state, toPlayer(alice))).toMatchObject({
      view: { stage: { phase: "ended", podium: [{ name: "Alice" }, { name: "Bob" }] } },
    });
  });

  test("prévient un joueur qui ne fait plus partie de la partie", () => {
    expect(snapshot(play(...lobby).state, toPlayer(carol))).toEqual({ type: "error", code: "kicked" });
  });

  describe("en mode équipes", () => {
    const teamLobby = [createTeam(alice, "Alice", red, "Rouges"), joinTeam(bob, "Bob", red), createTeam(carol, "Carol", blue, "Bleus")];

    test("donne au visiteur les équipes, qu'il peut rejoindre ou, tant que la partie n'a pas commencé, compléter", () => {
      const teams = [
        { teamId: red, name: "Rouges" },
        { teamId: blue, name: "Bleus" },
      ];
      // Le visiteur ne reçoit que de quoi choisir son équipe : ni joueurs, ni question.
      const view = { role: "visitor", mode: "teams", teams };
      expect(viewOf(snapshot(playTeams(...teamLobby).state, toVisitor))).toEqual({ ...view, canCreateTeam: true });
      expect(viewOf(snapshot(playTeams(...teamLobby, host("start")).state, toVisitor))).toEqual({ ...view, canCreateTeam: false });
    });

    test("regroupe les joueurs par équipe pour l'animateur, chacune dans l'ordre d'arrivée", () => {
      const { state } = playTeams(createTeam(alice, "Alice", red, "Rouges"), createTeam(carol, "Carol", blue, "Bleus"), joinTeam(bob, "Bob", red));
      expect(snapshot(state, toHost)).toMatchObject({
        view: { players: [{ nickname: "Alice", team: { name: "Rouges" } }, { nickname: "Bob", team: { name: "Rouges" } }, { nickname: "Carol" }] },
      });
    });

    test("donne à chaque membre son équipe, son capitaine et le choix de celui-ci", () => {
      const { state } = playTeams(...teamLobby, host("start"), answer(alice, 2));
      expect(snapshot(state, toPlayer(bob, red))).toMatchObject({
        view: { nickname: "Bob", team: { name: "Rouges", captain: "Alice" }, stage: { answered: true, teamAnswer: 2 } },
      });
    });
  });

  test("en solo, ne donne au visiteur aucune équipe à choisir", () => {
    expect(viewOf(snapshot(play(...lobby).state, toVisitor))).toEqual({ role: "visitor", mode: "solo", teams: [], canCreateTeam: false });
  });
});

test("aucun message destiné à un joueur ne contient la bonne réponse avant la révélation", () => {
  const { state, events } = play(join(alice, "Alice"), join(bob, "Bob"), host("start"), answer(alice, 1), host("tick", T0 + 1));
  const messages = [...events.map((event) => project(event, toPlayer(bob))), snapshot(state, toPlayer(bob))];
  expect(JSON.stringify(messages)).not.toContain("correctIndex");
});
