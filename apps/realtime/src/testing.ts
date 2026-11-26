import { randomInt } from "node:crypto";
import { createGame } from "@quorum/game-engine";
import { GameId, PROTOCOL_VERSION, Question, ServerMessage } from "@quorum/protocol";
import { signToken } from "@quorum/protocol/token";
import { Redis } from "ioredis";
import { pino } from "pino";
import { WebSocket } from "ws";
import { keys } from "./games.ts";
import { startNode } from "./node.ts";

export const TEST_REDIS_URL = "redis://localhost:6379/2";
export const ORIGIN = "http://localhost:8080";
const SECRET = "secret-de-test-".padEnd(32, "x");

export const question = Question.parse({
  id: crypto.randomUUID(),
  text: "La Terre est ronde.",
  choices: ["Vrai", "Faux"],
  correctIndex: 0,
  durationSec: 5,
});

export async function startTestNode({ leaseMs = 600 } = {}) {
  const redis = new Redis(TEST_REDIS_URL);
  const nodeId = `test-${crypto.randomUUID()}`;
  let offset = 0;
  const node = startNode({
    redis,
    nodeId,
    publicOrigin: ORIGIN,
    sessionSecret: SECRET,
    now: () => Date.now() + offset,
    logger: pino({ level: "silent" }),
    leaseMs,
  });
  await new Promise<void>((resolve) => node.server.listen(0, resolve));
  const address = node.server.address();
  if (!address || typeof address === "string") throw new Error("Le serveur de test n'écoute pas sur un port");
  return {
    nodeId,
    url: `ws://localhost:${String(address.port)}/ws`,
    redis,
    advanceClock(ms: number) {
      offset += ms;
    },
    shutdown: () => node.shutdown(),
    async close() {
      await node.close();
      redis.disconnect();
    },
  };
}

// Écrit une partie dans Redis comme le fait l'API, et renvoie de quoi s'y connecter.
export async function createTestGame(redis: Redis) {
  const gameId = GameId.parse(crypto.randomUUID());
  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await redis.set(`pin:${pin}`, gameId);
  await redis.set(keys(gameId).state, JSON.stringify(createGame(pin, [question])));
  const hostToken = signToken({ role: "host", gameId, exp: Date.now() + 60_000 }, SECRET);
  return { gameId, pin, hostToken };
}

type Message<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>;

export interface TestClient {
  send: (message: object) => void;
  receive: <T extends ServerMessage["type"]>(type: T) => Promise<Message<T>>;
  closed: Promise<number>;
  close: () => void;
}

export async function connect(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
  const socket = new WebSocket(url, { headers: { origin: ORIGIN, ...headers } });
  const inbox: ServerMessage[] = [];
  let notify = () => undefined;
  socket.on("message", (data) => {
    if (!Buffer.isBuffer(data)) throw new Error("Message binaire inattendu");
    inbox.push(ServerMessage.parse(JSON.parse(data.toString())));
    notify();
  });
  const closed = new Promise<number>((resolve) => socket.on("close", resolve));
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  // Attend le prochain message du type demandé ; les messages d'autres types restent dans la boîte.
  async function receive<T extends ServerMessage["type"]>(type: T): Promise<Message<T>> {
    const deadline = Date.now() + 3000;
    for (;;) {
      const index = inbox.findIndex((message) => message.type === type);
      const message = inbox[index];
      if (message && isType(message, type)) {
        inbox.splice(index, 1);
        return message;
      }
      if (Date.now() > deadline) throw new Error(`Aucun message ${type} reçu ; boîte : ${JSON.stringify(inbox)}`);
      await new Promise<void>((resolve) => {
        notify = () => {
          resolve();
          return undefined;
        };
        setTimeout(resolve, 100);
      });
    }
  }

  return {
    send: (message) => {
      socket.send(JSON.stringify(message));
    },
    receive,
    closed,
    close: () => {
      socket.close();
    },
  };
}

function isType<T extends ServerMessage["type"]>(message: ServerMessage, type: T): message is Message<T> {
  return message.type === type;
}

export async function connectHost(url: string, hostToken: string): Promise<TestClient> {
  const host = await connect(url);
  host.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, token: hostToken });
  await host.receive("snapshot");
  return host;
}

export async function joinAs(url: string, pin: string, nickname: string, headers: Record<string, string> = {}) {
  const player = await connect(url, headers);
  player.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
  player.send({ type: "join", pin, nickname });
  const { token } = await player.receive("welcome");
  await player.receive("snapshot");
  return { player, token };
}
