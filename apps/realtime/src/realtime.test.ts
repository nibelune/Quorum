import { PROTOCOL_VERSION } from "@quorum/protocol";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { keys } from "./games.ts";
import { connect, connectHost, createTestGame, joinAs, question, startTestNode } from "./testing.ts";

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
    client.send({ type: "join", pin: "123456", nickname: "Alice" });
    expect(await client.receive("error")).toEqual({ type: "error", code: "invalid_message" });
  });

  test("refuse un jeton invalide", async () => {
    const client = await connect(node.url);
    client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, token: "faux" });
    expect(await client.receive("error")).toEqual({ type: "error", code: "invalid_token" });
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
    client.send({ type: "join", pin: "999999", nickname: "Alice" });
    expect(await client.receive("error")).toEqual({ type: "error", code: "game_not_found" });
  });

  test("le joueur reçoit son jeton et la vue de la partie, l'animateur le voit arriver", async () => {
    const { pin, hostToken } = await createTestGame(node.redis);
    const host = await connectHost(node.url, hostToken);
    const player = await connect(node.url);
    player.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
    player.send({ type: "join", pin, nickname: "Alice" });
    expect((await player.receive("welcome")).token).toEqual(expect.any(String));
    expect((await player.receive("snapshot")).view).toEqual({ role: "player", nickname: "Alice", stage: { phase: "lobby" } });
    expect(await host.receive("player_joined")).toMatchObject({ nickname: "Alice" });
  });

  test("un pseudo déjà pris est refusé par le coordinateur", async () => {
    const { pin } = await createTestGame(node.redis);
    await joinAs(node.url, pin, "Alice");
    const second = await connect(node.url);
    second.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
    second.send({ type: "join", pin, nickname: "alice" });
    expect(await second.receive("error")).toEqual({ type: "error", code: "nickname_taken" });
  });

  test("au-delà de 10 PIN inconnus par minute depuis une même IP, les join suivants sont refusés", async () => {
    const client = await connect(node.url, { "x-forwarded-for": `10.0.0.${String(Math.floor(Math.random() * 250))}` });
    client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
    for (let i = 0; i < 11; i++) client.send({ type: "join", pin: "999999", nickname: "Alice" });
    for (let i = 0; i < 10; i++) expect(await client.receive("error")).toEqual({ type: "error", code: "game_not_found" });
    expect(await client.receive("error")).toEqual({ type: "error", code: "rate_limited" });
  });

  test("toute une salle derrière une même IP peut rejoindre", async () => {
    const { pin } = await createTestGame(node.redis);
    const ip = { "x-forwarded-for": `10.1.0.${String(Math.floor(Math.random() * 250))}` };
    for (let i = 0; i < 12; i++) await joinAs(node.url, pin, `Joueur ${String(i)}`, ip);
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
    expect((await host.receive("game_ended")).podium).toEqual([{ nickname: "Alice", score: ended.you?.score }]);
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
