import { describe, expect, test } from "vitest";
import { reduce } from "./reduce.ts";
import { GRACE_MS } from "./rules.ts";
import type { Command } from "./state.ts";
import {
  alice,
  answer,
  blue,
  bob,
  capital,
  carol,
  createTeam,
  dave,
  flatEarth,
  type Game,
  green,
  host,
  join,
  joinTeam,
  kick,
  play,
  playTeams,
  red,
  soloTeam,
  T0,
} from "./testing.ts";

const deadline = T0 + capital.durationSec * 1000;
const lobby = [join(alice, "Alice"), join(bob, "Bob")];
const question = [...lobby, host("start")];
// Alice répond juste et instantanément (1000 points), Bob se trompe.
const reveal = [...question, answer(alice, 1), answer(bob, 0)];
const leaderboard = [...reveal, host("next")];
const ended = [...lobby, host("end")];

function errorOf(commands: Command[], command: Command, replay: (...commands: Command[]) => Game = play) {
  const result = reduce(replay(...commands).state, command);
  return result.ok ? "accepted" : result.error;
}

describe("join", () => {
  test("en solo, le joueur forme une équipe d'un membre à son nom, avec 0 point, et l'annonce", () => {
    const { state, events } = play(join(alice, "Alice"));
    const team = { teamId: soloTeam(alice), name: "Alice" };
    expect(state.players).toEqual([{ playerId: alice, nickname: "Alice", teamId: team.teamId }]);
    expect(state.teams).toEqual([{ ...team, score: 0 }]);
    expect(events).toEqual([{ type: "player_joined", seq: 1, playerId: alice, nickname: "Alice", team }]);
  });

  test.each(["Alice", "alice", "ALICE"])("refuse le pseudo %s, déjà pris sans tenir compte de la casse", (nickname) => {
    expect(errorOf([join(alice, "Alice")], join(bob, nickname))).toBe("nickname_taken");
  });

  test("accepte un retardataire en cours de partie, avec 0 point", () => {
    expect(play(...leaderboard, join(carol, "Carol")).state.teams.at(-1)).toEqual({
      teamId: soloTeam(carol),
      name: "Carol",
      score: 0,
    });
  });

  test("refuse un joueur une fois la partie terminée", () => {
    expect(errorOf(ended, join(carol, "Carol"))).toBe("wrong_phase");
  });

  test("en solo, refuse un choix d'équipe", () => {
    expect(errorOf(lobby, joinTeam(carol, "Carol", soloTeam(alice)))).toBe("invalid_message");
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
      results: { [soloTeam(alice)]: { points: 750, score: 750 }, [soloTeam(bob)]: { points: 0, score: 0 } },
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
    expect(state.teams.map(({ score }) => score)).toEqual([2000, 1000]);
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
        { name: "Alice", score: 1000 },
        { name: "Bob", score: 0 },
      ],
      ranks: { [soloTeam(alice)]: { rank: 1, score: 1000 }, [soloTeam(bob)]: { rank: 2, score: 0 } },
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
    expect(events.at(-1)).toMatchObject({ type: "game_ended", podium: [{ name: "Alice" }, { name: "Bob" }] });
  });

  test.each([
    ["le lobby", lobby],
    ["une partie terminée", ended],
  ])("est refusé dans %s", (_, before) => {
    expect(errorOf(before, host("next"))).toBe("wrong_phase");
  });
});

describe("kick", () => {
  test("retire le joueur, son équipe et sa réponse, et l'annonce", () => {
    const { state, events } = play(...question, answer(alice, 1), kick(alice));
    expect(state.players.map(({ playerId }) => playerId)).toEqual([bob]);
    expect(state.teams.map(({ name }) => name)).toEqual(["Bob"]);
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

describe("mode équipes", () => {
  // Alice crée les Rouges et Bob les rejoint ; Carol joue seule chez les Bleus.
  const teamLobby = [createTeam(alice, "Alice", red, "Rouges"), joinTeam(bob, "Bob", red), createTeam(carol, "Carol", blue, "Bleus")];
  const teamQuestion = [...teamLobby, host("start")];

  test("le joueur crée une équipe ou en rejoint une ; seules les créations sont annoncées aux visiteurs", () => {
    const { state, events } = playTeams(...teamLobby);
    const reds = { teamId: red, name: "Rouges" };
    expect(state.teams).toEqual([
      { ...reds, score: 0 },
      { teamId: blue, name: "Bleus", score: 0 },
    ]);
    expect(state.players.map(({ teamId }) => teamId)).toEqual([red, red, blue]);
    expect(events.slice(0, 3)).toEqual([
      { type: "team_created", seq: 1, team: reds },
      { type: "player_joined", seq: 2, playerId: alice, nickname: "Alice", team: reds },
      { type: "player_joined", seq: 3, playerId: bob, nickname: "Bob", team: reds },
    ]);
  });

  test("accepte un retardataire dans une équipe existante", () => {
    expect(errorOf(teamQuestion, joinTeam(dave, "Dave", blue), playTeams)).toBe("accepted");
  });

  test.each([
    { error: "team_name_taken", label: "un nom d'équipe déjà pris", before: teamLobby, command: createTeam(dave, "Dave", green, "rouges") },
    { error: "team_not_found", label: "une équipe inconnue", before: teamLobby, command: joinTeam(dave, "Dave", green) },
    { error: "wrong_phase", label: "une nouvelle équipe une fois la partie lancée", before: teamQuestion, command: createTeam(dave, "Dave", green, "Verts") },
    { error: "invalid_message", label: "un joueur sans équipe", before: teamLobby, command: join(dave, "Dave") },
    { error: "not_captain", label: "la réponse d'un membre qui n'est pas capitaine", before: teamQuestion, command: answer(bob, 1) },
  ])("refuse $label ($error)", ({ error, before, command }) => {
    expect(errorOf(before, command, playTeams)).toBe(error);
  });

  test("annonce le choix du capitaine à ses coéquipiers, et seulement s'il en a", () => {
    expect(playTeams(...teamQuestion, answer(alice, 1)).events.at(-1)).toEqual({
      type: "team_answer_locked",
      seq: 7,
      teamId: red,
      choiceIndex: 1,
    });
    expect(reduce(playTeams(...teamQuestion).state, answer(carol, 1))).toMatchObject({ ok: true, events: [] });
  });

  test("clôt la question dès que chaque équipe a répondu, et donne les points à l'équipe", () => {
    expect(playTeams(...teamQuestion, answer(alice, 1), answer(carol, 0)).events.at(-1)).toMatchObject({
      type: "question_ended",
      distribution: [1, 1, 0],
      results: { [red]: { points: 1000, score: 1000 }, [blue]: { points: 0, score: 0 } },
    });
  });

  test("un capitaine exclu laisse sa place au membre arrivé le plus tôt, qui répond à son tour", () => {
    const { state, events } = playTeams(...teamQuestion, answer(alice, 1), kick(alice));
    expect(events.slice(-2)).toEqual([
      { type: "player_left", seq: 8, playerId: alice },
      { type: "captain_changed", seq: 9, teamId: red, captain: "Bob" },
    ]);
    expect(reduce(state, answer(bob, 2)).ok).toBe(true);
  });

  test("exclure un simple membre ne change pas de capitaine", () => {
    expect(playTeams(...teamLobby, kick(bob)).events.at(-1)).toEqual({ type: "player_left", seq: 6, playerId: bob });
  });

  test("une équipe vide disparaît", () => {
    expect(playTeams(...teamLobby, kick(carol)).state.teams.map(({ teamId }) => teamId)).toEqual([red]);
  });
});
