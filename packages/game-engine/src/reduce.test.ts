import { describe, expect, test } from "vitest";
import { reduce } from "./reduce.ts";
import { GRACE_MS } from "./rules.ts";
import type { Command } from "./state.ts";
import { alice, answer, bob, capital, carol, flatEarth, host, join, kick, play, T0 } from "./testing.ts";

const deadline = T0 + capital.durationSec * 1000;
const lobby = [join(alice, "Alice"), join(bob, "Bob")];
const question = [...lobby, host("start")];
// Alice répond juste et instantanément (1000 points), Bob se trompe.
const reveal = [...question, answer(alice, 1), answer(bob, 0)];
const leaderboard = [...reveal, host("next")];
const ended = [...lobby, host("end")];

function errorOf(commands: Command[], command: Command) {
  const result = reduce(play(...commands).state, command);
  return result.ok ? "accepted" : result.error;
}

describe("join", () => {
  test("ajoute le joueur avec 0 point et l'annonce", () => {
    const { state, events } = play(join(alice, "Alice"));
    expect(state.players).toEqual([{ playerId: alice, nickname: "Alice", score: 0 }]);
    expect(events).toEqual([{ type: "player_joined", seq: 1, playerId: alice, nickname: "Alice" }]);
  });

  test.each(["Alice", "alice", "ALICE"])("refuse le pseudo %s, déjà pris sans tenir compte de la casse", (nickname) => {
    expect(errorOf([join(alice, "Alice")], join(bob, nickname))).toBe("nickname_taken");
  });

  test("accepte un retardataire en cours de partie, avec 0 point", () => {
    expect(play(...leaderboard, join(carol, "Carol")).state.players.at(-1)).toEqual({
      playerId: carol,
      nickname: "Carol",
      score: 0,
    });
  });

  test("refuse un joueur une fois la partie terminée", () => {
    expect(errorOf(ended, join(carol, "Carol"))).toBe("wrong_phase");
  });
});

describe("start", () => {
  test("lance la première question, sans la bonne réponse", () => {
    const { state, events } = play(...question);
    expect(state.current.phase).toBe("question");
    expect(events.at(-1)).toStrictEqual({
      type: "question_started",
      seq: 3,
      questionId: capital.id,
      text: capital.text,
      choices: capital.choices,
      deadline,
    });
  });

  test("refuse une partie sans joueur", () => {
    expect(errorOf([], host("start"))).toBe("no_players");
  });

  test("refuse une partie déjà lancée", () => {
    expect(errorOf(question, host("start"))).toBe("wrong_phase");
  });
});

describe("answer", () => {
  test("enregistre la réponse sans rien diffuser", () => {
    const result = reduce(play(...question).state, answer(alice, 1));
    expect(result).toMatchObject({ ok: true, events: [] });
  });

  test("accepte une réponse pendant la tolérance réseau", () => {
    expect(errorOf(question, answer(alice, 1, deadline + GRACE_MS))).toBe("accepted");
  });

  test("clôt la question dès que tous les joueurs ont répondu", () => {
    expect(play(...reveal).state.current.phase).toBe("reveal");
  });

  test.each([
    { error: "already_answered", label: "une deuxième réponse", before: [...question, answer(alice, 1)], command: answer(alice, 0) },
    { error: "too_late", label: "une réponse après la tolérance", before: question, command: answer(alice, 1, deadline + GRACE_MS + 1) },
    { error: "too_late", label: "une réponse à une autre question", before: question, command: answer(alice, 1, T0, flatEarth.id) },
    { error: "too_late", label: "une réponse après la clôture", before: [...question, host("next")], command: answer(alice, 1) },
    { error: "invalid_message", label: "un choix absent de la question", before: question, command: answer(alice, 3) },
    { error: "kicked", label: "la réponse d'un joueur exclu", before: [...question, kick(alice)], command: answer(alice, 1) },
  ])("refuse $label ($error)", ({ error, before, command }) => {
    expect(errorOf(before, command)).toBe(error);
  });
});

describe("tick", () => {
  test("annonce le nombre de réponses une seule fois quand il change", () => {
    const { events } = play(...question, answer(alice, 1), host("tick", T0 + 1), host("tick", T0 + 2));
    expect(events.slice(3)).toEqual([{ type: "answer_count", seq: 4, count: 1 }]);
  });

  test("clôt la question une fois la tolérance réseau écoulée", () => {
    expect(play(...question, host("tick", deadline + GRACE_MS)).state.current.phase).toBe("question");
    expect(play(...question, host("tick", deadline + GRACE_MS + 1)).state.current.phase).toBe("reveal");
  });

  test("ne fait rien hors d'une question", () => {
    const { state } = play(...lobby);
    expect(reduce(state, host("tick"))).toEqual({ ok: true, state, events: [] });
  });
});

describe("fin d'une question", () => {
  test("donne la bonne réponse, la répartition et le résultat de chaque joueur", () => {
    const { events } = play(...question, answer(alice, 1, T0 + 10_000), answer(bob, 0));
    expect(events.at(-1)).toEqual({
      type: "question_ended",
      seq: 4,
      correctIndex: 1,
      distribution: [1, 1, 0],
      results: { [alice]: { points: 750, score: 750 }, [bob]: { points: 0, score: 0 } },
    });
  });

  test("cumule les scores d'une question à l'autre", () => {
    const start2 = T0 + 60_000;
    const { state } = play(
      ...leaderboard,
      host("next", start2),
      answer(alice, 1, start2, flatEarth.id),
      answer(bob, 1, start2, flatEarth.id),
    );
    expect(state.players.map(({ score }) => score)).toEqual([2000, 1000]);
  });
});

describe("next", () => {
  test("pendant une question, la clôt sans attendre", () => {
    expect(play(...question, host("next")).events.at(-1)?.type).toBe("question_ended");
  });

  test("après la révélation, affiche le classement", () => {
    expect(play(...leaderboard).events.at(-1)).toEqual({
      type: "leaderboard",
      seq: 5,
      top: [
        { nickname: "Alice", score: 1000 },
        { nickname: "Bob", score: 0 },
      ],
      ranks: { [alice]: { rank: 1, score: 1000 }, [bob]: { rank: 2, score: 0 } },
    });
  });

  test("après le classement, lance la question suivante", () => {
    const start2 = T0 + 60_000;
    expect(play(...leaderboard, host("next", start2)).events.at(-1)).toMatchObject({
      type: "question_started",
      questionId: flatEarth.id,
      deadline: start2 + flatEarth.durationSec * 1000,
    });
  });

  test("après le classement de la dernière question, termine la partie avec le podium", () => {
    const { state, events } = play(...leaderboard, host("next"), host("next"), host("next"), host("next"));
    expect(state.current.phase).toBe("ended");
    expect(events.at(-1)).toMatchObject({ type: "game_ended", podium: [{ nickname: "Alice" }, { nickname: "Bob" }] });
  });

  test.each([
    ["le lobby", lobby],
    ["une partie terminée", ended],
  ])("est refusé dans %s", (_, before) => {
    expect(errorOf(before, host("next"))).toBe("wrong_phase");
  });
});

describe("kick", () => {
  test("retire le joueur et sa réponse, et l'annonce", () => {
    const { state, events } = play(...question, answer(alice, 1), kick(alice));
    expect(state.players.map(({ playerId }) => playerId)).toEqual([bob]);
    expect(state.current).toMatchObject({ phase: "question", answers: [] });
    expect(events.at(-1)).toEqual({ type: "player_left", seq: 4, playerId: alice });
  });

  test("ignore un joueur déjà parti", () => {
    expect(reduce(play(...lobby, kick(alice)).state, kick(alice))).toMatchObject({ ok: true, events: [] });
  });

  test("est refusé une fois la partie terminée", () => {
    expect(errorOf(ended, kick(alice))).toBe("wrong_phase");
  });
});

describe("end", () => {
  test.each([
    ["le lobby", lobby],
    ["une question", question],
    ["la révélation", reveal],
    ["le classement", leaderboard],
  ])("termine la partie depuis %s", (_, before) => {
    const { state, events } = play(...before, host("end"));
    expect(state.current.phase).toBe("ended");
    expect(events.at(-1)?.type).toBe("game_ended");
  });

  test("est refusé une fois la partie terminée", () => {
    expect(errorOf(ended, host("end"))).toBe("wrong_phase");
  });
});
