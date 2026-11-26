import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { CreatedGame, HostToken, PROTOCOL_VERSION, Quiz, ServerMessage } from "@quorum/protocol";
import { Redis } from "ioredis";
import { afterAll, expect, test } from "vitest";
import { WebSocket } from "ws";

// Lancé par `make chaos` sur la pile du Compose (`make up`), avec realtime en 3 répliques.
const ORIGIN = process.env["PUBLIC_ORIGIN"] ?? "http://localhost:8080";
const redis = new Redis("redis://localhost:6379");
const killed: string[] = [];

afterAll(() => {
  for (const container of killed) execFileSync("docker", ["start", container]);
  redis.disconnect();
});

type Message<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>;

interface Client {
  send: (message: object) => void;
  receive: <T extends ServerMessage["type"]>(type: T) => Promise<Message<T>>;
}

// Un client qui se comporte comme le web : après une coupure, il revient par Caddy avec son jeton et `lastSeq`.
function connect(token?: string, onFirstOpen?: (client: Client) => void): Client {
  let lastSeq: number | undefined;
  let first = true;
  // Comme le web : une réponse sans accusé de réception est renvoyée après la reconnexion.
  let pendingAnswer: string | undefined;
  let socket: WebSocket;
  const inbox: ServerMessage[] = [];
  const outbox: string[] = [];

  const open = () => {
    socket = new WebSocket(`${ORIGIN.replace(/^http/, "ws")}/ws`, { headers: { origin: ORIGIN } });
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION, token, lastSeq }));
      if (first) onFirstOpen?.(client);
      first = false;
      for (const text of outbox.splice(0)) socket.send(text);
      if (pendingAnswer) socket.send(pendingAnswer);
    });
    socket.on("message", (data) => {
      if (!Buffer.isBuffer(data)) return;
      const message = ServerMessage.parse(JSON.parse(data.toString()));
      if (message.type === "welcome") token = message.token;
      if ("seq" in message) lastSeq = message.seq;
      if (message.type === "answer_received" || message.type === "question_ended") pendingAnswer = undefined;
      inbox.push(message);
    });
    socket.on("close", () => {
      setTimeout(open, 250);
    });
    socket.on("error", () => undefined);
  };

  const client: Client = {
    send(message) {
      const text = JSON.stringify(message);
      if ("type" in message && message.type === "answer") pendingAnswer = text;
      if (socket.readyState === WebSocket.OPEN) socket.send(text);
      else outbox.push(text);
    },
    async receive<T extends ServerMessage["type"]>(type: T): Promise<Message<T>> {
      const deadline = Date.now() + 30_000;
      for (;;) {
        const index = inbox.findIndex((message) => message.type === type);
        const message = inbox[index];
        if (message && isType(message, type)) {
          inbox.splice(index, 1);
          return message;
        }
        if (Date.now() > deadline) throw new Error(`Aucun message ${type} reçu`);
        await sleep(50);
      }
    },
  };
  open();
  return client;
}

function isType<T extends ServerMessage["type"]>(message: ServerMessage, type: T): message is Message<T> {
  return message.type === type;
}

// Partie créée par l'API, comme depuis le dashboard : deux vrai/faux de 20 s.
async function createGame() {
  const json = { "content-type": "application/json", origin: ORIGIN };
  const signUp = await fetch(`${ORIGIN}/api/auth/sign-up/email`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ name: "Chaos", email: `chaos-${crypto.randomUUID()}@quorum.test`, password: "un-mot-de-passe-solide" }),
  });
  const cookie = signUp.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const headers = { ...json, cookie };
  const question = (text: string, correctIndex: number) => ({ text, choices: ["Vrai", "Faux"], correctIndex, durationSec: 20 });
  const quiz = Quiz.parse(
    await (
      await fetch(`${ORIGIN}/api/quizzes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Chaos", questions: [question("2 + 2 = 4", 0), question("La Terre est plate.", 1)] }),
      })
    ).json(),
  );
  const { gameId, pin } = CreatedGame.parse(
    await (await fetch(`${ORIGIN}/api/games`, { method: "POST", headers, body: JSON.stringify({ quizId: quiz.id, mode: "solo" }) })).json(),
  );
  const { token } = HostToken.parse(
    await (await fetch(`${ORIGIN}/api/games/${gameId}/host-token`, { method: "POST", headers: { origin: ORIGIN, cookie } })).json(),
  );
  return { gameId, pin, hostToken: token, questions: quiz.questions };
}

// Le lease vaut `{nodeId}:{token}`, et le nodeId d'un nœud est le hostname de son conteneur.
async function coordinatorOf(gameId: string): Promise<string> {
  return (await redis.get(`game:${gameId}:lease`))?.split(":")[0] ?? "";
}

test("la partie se termine normalement quand on tue son coordinateur en pleine question", async () => {
  const { gameId, pin, hostToken, questions } = await createGame();
  const [first, second] = questions;
  if (!first || !second) throw new Error("Le quiz doit avoir deux questions");

  const host = connect(hostToken);
  await host.receive("snapshot");
  const players = ["Alice", "Bob", "Chloé"].map((nickname) =>
    connect(undefined, (client) => {
      client.send({ type: "lookup", pin });
      client.send({ type: "join", nickname });
    }),
  );
  for (const player of players) await player.receive("welcome");

  host.send({ type: "start" });
  let shown: string[] = [];
  for (const player of players) shown = (await player.receive("question_started")).choices;
  // L'API a mélangé les choix : la bonne réponse à « 2 + 2 = 4 » se retrouve par son texte.
  const correctIndex = shown.indexOf("Vrai");
  const coordinator = await coordinatorOf(gameId);
  execFileSync("docker", ["kill", coordinator]);
  killed.push(coordinator);

  // Les réponses arrivent pendant la panne : le nouveau coordinateur les applique une fois le lease repris.
  for (const player of players) player.send({ type: "answer", questionId: first.id, choiceIndex: correctIndex });
  for (const player of players) expect((await player.receive("question_ended")).you?.points).toBeGreaterThan(0);
  await host.receive("question_ended");
  expect(await coordinatorOf(gameId)).not.toBe(coordinator);

  host.send({ type: "next" });
  await host.receive("leaderboard");
  host.send({ type: "next" });
  for (const player of players) await player.receive("question_started");
  for (const player of players) player.send({ type: "answer", questionId: second.id, choiceIndex: 1 });
  await host.receive("question_ended");
  host.send({ type: "next" });
  await host.receive("leaderboard");
  host.send({ type: "next" });
  expect((await host.receive("game_ended")).podium).toHaveLength(3);
});
