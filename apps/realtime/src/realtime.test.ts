import { PROTOCOL_VERSION } from "@quorum/protocol";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { keys } from "./games.ts";
import { connect, connectHost, createTestGame, joinAs, question, startTestNode, visit } from "./testing.ts";

let node: Awaited<ReturnType<typeof startTestNode>>;
beforeAll(async () => {
  node = await startTestNode();
});
afterAll(() => node.close());

describe("connexion", () => {
  test("refuse l'upgrade d'une autre origine", async () => {
    await expect(connect(node.url, { origin: "http://pirate.test" })).rejects.toThrow("403");
  });

  test("demande à un client d'une autre version de recharger la page", async () => {
    const client = await connect(node.url);
    client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION + 1 });
    await client.receive("reload");
    await client.closed;
  });

  test("exige hello avant tout autre message", async () => {
    const client = await connect(node.url);
    client.send({ type: "lookup", pin: "123456" });
    expect(await client.receive("error")).toEqual({ type: "error", code: "invalid_message" });
  });

  test("refuse un jeton invalide", async () => {
    const client = await connect(node.url);
    client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, token: "faux" });
    expect(await client.receive("error")).toEqual({ type: "error", code: "invalid_token" });
  });

  test("répond à un ping avec l'heure du serveur, pour la synchronisation d'horloge", async () => {
    const client = await connect(node.url);
    client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
    const before = Date.now();
    client.send({ type: "ping", t: 42 });
    const { t, serverTime } = await client.receive("pong");
    expect(t).toBe(42);
    expect(serverTime).toBeGreaterThanOrEqual(before);
  });

  test("ferme la connexion au-delà de 20 messages par seconde", async () => {
    const client = await connect(node.url);
    for (let i = 0; i < 21; i++) client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
    expect(await client.closed).toBe(1008);
  });
});

describe("join", () => {
  test("un PIN inconnu ne correspond à aucune partie", async () => {
    const client = await connect(node.url);
    client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
    client.send({ type: "lookup", pin: "999999" });
    expect(await client.receive("error")).toEqual({ type: "error", code: "game_not_found" });
  });

  test("join exige d'avoir trouvé la partie par son PIN", async () => {
    const client = await connect(node.url);
    client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
    client.send({ type: "join", nickname: "Alice" });
    expect(await client.receive("error")).toEqual({ type: "error", code: "forbidden" });
  });

  test("le joueur reçoit son jeton et la vue de la partie, l'animateur le voit arriver", async () => {
    const { pin, hostToken } = await createTestGame(node.redis);
    const host = await connectHost(node.url, hostToken);
    const { visitor: player, info } = await visit(node.url, pin);
    expect(info).toEqual({ type: "game_info", mode: "solo", teams: [], canCreateTeam: false });
    player.send({ type: "join", nickname: "Alice" });
    expect((await player.receive("welcome")).token).toEqual(expect.any(String));
    expect((await player.receive("snapshot")).view).toEqual({
      role: "player",
      mode: "solo",
      nickname: "Alice",
      team: { name: "Alice", captain: "Alice" },
      stage: { phase: "lobby" },
    });
    expect(await host.receive("player_joined")).toMatchObject({ nickname: "Alice" });
  });

  test("un pseudo déjà pris est refusé par le coordinateur, et le visiteur peut réessayer", async () => {
    const { pin } = await createTestGame(node.redis);
    await joinAs(node.url, pin, "Alice");
    const { visitor } = await visit(node.url, pin);
    visitor.send({ type: "join", nickname: "alice" });
    expect(await visitor.receive("error")).toEqual({ type: "error", code: "nickname_taken" });
    visitor.send({ type: "join", nickname: "Alicia" });
    await visitor.receive("welcome");
  });

  test("au-delà de 10 PIN inconnus par minute depuis une même IP, les lookup suivants sont refusés", async () => {
    const client = await connect(node.url, { "x-real-ip": `10.0.0.${String(Math.floor(Math.random() * 250))}` });
    client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
    for (let i = 0; i < 11; i++) client.send({ type: "lookup", pin: "999999" });
    for (let i = 0; i < 10; i++) expect(await client.receive("error")).toEqual({ type: "error", code: "game_not_found" });
    expect(await client.receive("error")).toEqual({ type: "error", code: "rate_limited" });
  });

  test("toute une salle derrière une même IP peut rejoindre", async () => {
    const { pin } = await createTestGame(node.redis);
    const ip = { "x-real-ip": `10.1.0.${String(Math.floor(Math.random() * 250))}` };
    for (let i = 0; i < 12; i++) await joinAs(node.url, pin, `Joueur ${String(i)}`, { headers: ip });
  });

  test("un joueur se reconnecte avec son jeton", async () => {
    const { pin } = await createTestGame(node.redis);
    const { player, token } = await joinAs(node.url, pin, "Alice");
    player.close();
    const again = await connect(node.url);
    again.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, token });
    expect((await again.receive("snapshot")).view).toMatchObject({ role: "player", nickname: "Alice" });
  });
});

describe("partie", () => {
  test("un joueur ne peut pas lancer la partie", async () => {
    const { pin } = await createTestGame(node.redis);
    const { player } = await joinAs(node.url, pin, "Alice");
    player.send({ type: "start" });
    expect(await player.receive("error")).toEqual({ type: "error", code: "forbidden" });
  });

  test("se joue du lobby au podium", async () => {
    const { pin, hostToken } = await createTestGame(node.redis);
    const host = await connectHost(node.url, hostToken);
    const { player } = await joinAs(node.url, pin, "Alice");

    host.send({ type: "start" });
    const started = await player.receive("question_started");
    expect(started).toMatchObject({ questionId: question.id, choices: ["Vrai", "Faux"] });
    expect(started).not.toHaveProperty("correctIndex");

    player.send({ type: "answer", questionId: question.id, choiceIndex: 0 });
    await player.receive("answer_received");
    const ended = await player.receive("question_ended");
    expect(ended.correctIndex).toBe(0);
    expect(ended.you?.points).toBeGreaterThan(500);
    await host.receive("question_ended");

    host.send({ type: "next" });
    expect((await player.receive("leaderboard")).you).toMatchObject({ rank: 1 });
    host.send({ type: "next" });
    expect((await host.receive("game_ended")).podium).toEqual([{ name: "Alice", score: ended.you?.score }]);
  });

  test("le chrono clôt la question à la deadline et tient l'animateur au courant des réponses", async () => {
    const { pin, hostToken } = await createTestGame(node.redis);
    const host = await connectHost(node.url, hostToken);
    const { player } = await joinAs(node.url, pin, "Alice");
    await joinAs(node.url, pin, "Bob");

    host.send({ type: "start" });
    await player.receive("question_started");
    player.send({ type: "answer", questionId: question.id, choiceIndex: 0 });
    expect(await host.receive("answer_count")).toMatchObject({ count: 1 });

    node.advanceClock(question.durationSec * 1000 + 1000);
    expect(await host.receive("question_ended")).toMatchObject({ distribution: [1, 0] });
  });

  test("un joueur exclu est prévenu puis déconnecté", async () => {
    const { pin, hostToken } = await createTestGame(node.redis);
    const host = await connectHost(node.url, hostToken);
    const { player } = await joinAs(node.url, pin, "Alice");
    const { playerId } = await host.receive("player_joined");

    host.send({ type: "kick", playerId });
    expect(await player.receive("error")).toEqual({ type: "error", code: "kicked" });
    await player.closed;
  });
});

describe("mode équipes", () => {
  test("le visiteur voit les équipes se créer en direct, puis rejoint la sienne", async () => {
    const { pin } = await createTestGame(node.redis, "teams");
    const { visitor, info } = await visit(node.url, pin);
    expect(info).toEqual({ type: "game_info", mode: "teams", teams: [], canCreateTeam: true });

    await joinAs(node.url, pin, "Alice", { team: { create: "Rouges" } });
    const { team } = await visitor.receive("player_joined");
    expect(team.name).toBe("Rouges");

    visitor.send({ type: "join", nickname: "Bob", team: { join: team.teamId } });
    await visitor.receive("welcome");
    expect((await visitor.receive("snapshot")).view).toMatchObject({ mode: "teams", team: { name: "Rouges", captain: "Alice" } });
  });

  test("seul le capitaine répond, et son choix ne va qu'à son équipe", async () => {
    const { pin, hostToken } = await createTestGame(node.redis, "teams");
    const host = await connectHost(node.url, hostToken);
    const { player: alice } = await joinAs(node.url, pin, "Alice", { team: { create: "Rouges" } });
    const { team } = await host.receive("player_joined");
    const { player: bob } = await joinAs(node.url, pin, "Bob", { team: { join: team.teamId } });
    const { player: carol } = await joinAs(node.url, pin, "Carol", { team: { create: "Bleus" } });

    host.send({ type: "start" });
    await bob.receive("question_started");
    bob.send({ type: "answer", questionId: question.id, choiceIndex: 1 });
    expect(await bob.receive("error")).toEqual({ type: "error", code: "not_captain" });

    alice.send({ type: "answer", questionId: question.id, choiceIndex: 0 });
    expect(await bob.receive("team_answer_locked")).toMatchObject({ choiceIndex: 0 });
    await carol.receive("question_started");
    expect(carol.pending().map(({ type }) => type)).not.toContain("team_answer_locked");
  });
});

describe("reconnexion", () => {
  test("un client qui revient avec lastSeq reçoit les événements manqués, sans snapshot", async () => {
    const { pin, hostToken } = await createTestGame(node.redis);
    const host = await connectHost(node.url, hostToken);
    await joinAs(node.url, pin, "Alice");
    expect(await host.receive("player_joined")).toMatchObject({ seq: 1 });
    host.close();
    await joinAs(node.url, pin, "Bob");

    const again = await connect(node.url);
    again.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, token: hostToken, lastSeq: 1 });
    expect(await again.receive("player_joined")).toMatchObject({ seq: 2, nickname: "Bob" });
    expect(again.pending().map(({ type }) => type)).not.toContain("snapshot");
  });

  test("si les événements manqués ont été purgés du stream, le client reçoit un snapshot", async () => {
    const { gameId, pin, hostToken } = await createTestGame(node.redis);
    await joinAs(node.url, pin, "Alice");
    await joinAs(node.url, pin, "Bob");
    await node.redis.xtrim(keys(gameId).events, "MINID", "3-0");

    const host = await connect(node.url);
    host.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, token: hostToken, lastSeq: 0 });
    const { seq, view } = await host.receive("snapshot");
    expect(seq).toBe(2);
    expect(view).toMatchObject({ players: [{ nickname: "Alice" }, { nickname: "Bob" }] });
  });
});
