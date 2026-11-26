import { describe, expect, test } from "vitest";
import { project, type Recipient, snapshot } from "./project.ts";
import type { GameEvent } from "./state.ts";
import { alice, answer, bob, capital, carol, host, join, play, T0 } from "./testing.ts";

const toHost: Recipient = { role: "host" };
const toPlayer = (playerId: typeof alice): Recipient => ({ role: "player", playerId });

describe("project", () => {
  test.each<GameEvent>([
    { type: "player_joined", seq: 1, playerId: alice, nickname: "Alice" },
    { type: "answer_count", seq: 4, count: 1 },
  ])("$type ne va qu'à l'animateur", (event) => {
    expect(project(event, toHost)).toBe(event);
    expect(project(event, toPlayer(alice))).toBeNull();
  });

  test("player_left va à l'animateur et prévient le joueur exclu", () => {
    const event: GameEvent = { type: "player_left", seq: 4, playerId: alice };
    expect(project(event, toHost)).toBe(event);
    expect(project(event, toPlayer(alice))).toEqual({ type: "error", code: "kicked" });
    expect(project(event, toPlayer(bob))).toBeNull();
  });

  test.each<GameEvent>([
    { type: "question_started", seq: 3, questionId: capital.id, text: capital.text, choices: capital.choices, deadline: T0 },
    { type: "game_ended", seq: 9, podium: [{ nickname: "Alice", score: 1000 }] },
  ])("$type va à tout le monde tel quel", (event) => {
    expect(project(event, toHost)).toBe(event);
    expect(project(event, toPlayer(alice))).toBe(event);
  });

  test("question_ended ne donne à chaque joueur que son propre résultat", () => {
    const event: GameEvent = {
      type: "question_ended",
      seq: 4,
      correctIndex: 1,
      distribution: [1, 1, 0],
      results: { [alice]: { points: 1000, score: 1000 }, [bob]: { points: 0, score: 0 } },
    };
    const shared = { type: "question_ended", seq: 4, correctIndex: 1, distribution: [1, 1, 0] };
    expect(project(event, toHost)).toStrictEqual(shared);
    expect(project(event, toPlayer(alice))).toStrictEqual({ ...shared, you: { points: 1000, score: 1000 } });
    expect(project(event, toPlayer(carol))).toEqual(shared);
  });

  test("leaderboard ne donne à chaque joueur que son propre rang", () => {
    const top = [{ nickname: "Alice", score: 1000 }];
    const event: GameEvent = { type: "leaderboard", seq: 5, top, ranks: { [alice]: { rank: 1, score: 1000 } } };
    expect(project(event, toHost)).toStrictEqual({ type: "leaderboard", seq: 5, top });
    expect(project(event, toPlayer(alice))).toStrictEqual({ type: "leaderboard", seq: 5, top, you: { rank: 1, score: 1000 } });
  });
});

describe("snapshot", () => {
  const lobby = [join(alice, "Alice"), join(bob, "Bob")];
  const question = [...lobby, host("start"), answer(alice, 1)];
  const shown = { questionId: capital.id, text: capital.text, choices: capital.choices, deadline: T0 + 20_000 };

  test("donne à l'animateur le PIN et les joueurs", () => {
    expect(snapshot(play(...lobby).state, toHost)).toStrictEqual({
      type: "snapshot",
      seq: 2,
      view: {
        role: "host",
        pin: "123456",
        players: [
          { playerId: alice, nickname: "Alice" },
          { playerId: bob, nickname: "Bob" },
        ],
        stage: { phase: "lobby" },
      },
    });
  });

  test("pendant une question, donne le nombre de réponses à l'animateur et à chaque joueur s'il a répondu", () => {
    const { state } = play(...question);
    expect(snapshot(state, toHost)).toMatchObject({ view: { stage: { phase: "question", question: shown, answerCount: 1 } } });
    expect(snapshot(state, toPlayer(alice))).toStrictEqual({
      type: "snapshot",
      seq: 3,
      view: { role: "player", nickname: "Alice", stage: { phase: "question", question: shown, answered: true } },
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
      view: { stage: { phase: "leaderboard", top: [{ nickname: "Alice" }, { nickname: "Bob" }], you: { rank: 2, score: 0 } } },
    });
  });

  test("à la fin, donne le podium", () => {
    expect(snapshot(play(...lobby, host("end")).state, toPlayer(alice))).toMatchObject({
      view: { stage: { phase: "ended", podium: [{ nickname: "Alice" }, { nickname: "Bob" }] } },
    });
  });

  test("prévient un joueur qui ne fait plus partie de la partie", () => {
    expect(snapshot(play(...lobby).state, toPlayer(carol))).toEqual({ type: "error", code: "kicked" });
  });
});

test("aucun message destiné à un joueur ne contient la bonne réponse avant la révélation", () => {
  const { state, events } = play(join(alice, "Alice"), join(bob, "Bob"), host("start"), answer(alice, 1), host("tick", T0 + 1));
  const messages = [...events.map((event) => project(event, toPlayer(bob))), snapshot(state, toPlayer(bob))];
  expect(JSON.stringify(messages)).not.toContain("correctIndex");
});
