import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { type Command, joinedTeamId, snapshot } from "@quorum/game-engine";
import { ClientMessage, type ErrorCode, GameId, PlayerId, PROTOCOL_VERSION, TeamId } from "@quorum/protocol";
import { signToken, verifyToken } from "@quorum/protocol/token";
import type { RawData, WebSocket } from "ws";
import {
  addCommand,
  type Client,
  currentState,
  ensureGame,
  type Identity,
  type Node,
  parseJson,
  release,
  type Reply,
  send,
} from "./games.ts";

const MESSAGES_PER_SECOND = 20;
// Seuls les PIN inconnus comptent : une salle entière peut rejoindre depuis une même IP (le Wi-Fi d'un bar),
// mais tester les PIN un par un reste impraticable.
const UNKNOWN_PINS_PER_MINUTE = 10;

export function handleConnection(node: Node, socket: WebSocket, request: IncomingMessage): void {
  const { deps } = node;
  const id = randomUUID();
  const client: Client = {
    id,
    socket,
    ip: clientIp(request),
    log: deps.logger.child({ connId: id }),
    helloed: false,
    identity: undefined,
    joining: undefined,
    window: { start: deps.now(), count: 0 },
    position: 0,
    queue: Promise.resolve(),
  };
  node.clients.set(id, client);
  client.log.info("connexion");

  socket.on("message", (data) => {
    const now = deps.now();
    if (now - client.window.start >= 1000) client.window = { start: now, count: 0 };
    if (++client.window.count > MESSAGES_PER_SECOND) {
      socket.close(1008);
      return;
    }
    client.queue = client.queue
      .then(() => handleMessage(node, client, data))
      .catch((error: unknown) => {
        client.log.error({ err: error }, "message non traité");
      });
  });
  socket.on("close", (code) => {
    node.clients.delete(id);
    client.joining = undefined;
    void leave(node, client);
    client.log.info({ code }, "fermeture");
  });
}

// X-Real-IP est toujours posé par Caddy, et realtime n'est joignable qu'à travers lui.
function clientIp(request: IncomingMessage): string {
  const realIp = request.headers["x-real-ip"];
  return (Array.isArray(realIp) ? realIp[0] : realIp) ?? request.socket.remoteAddress ?? "inconnue";
}

async function handleMessage(node: Node, client: Client, data: RawData): Promise<void> {
  const { deps } = node;
  const now = deps.now();
  const parsed = ClientMessage.safeParse(parseJson(Buffer.isBuffer(data) ? data.toString() : undefined));
  if (!parsed.success || (!client.helloed && parsed.data.type !== "hello")) {
    fail(client, "invalid_message");
    return;
  }
  const message = parsed.data;
  const identity = client.identity;

  switch (message.type) {
    case "hello": {
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        send(client, { type: "reload" });
        client.socket.close();
        return;
      }
      client.helloed = true;
      if (message.token === undefined) return;
      const payload = verifyToken(message.token, deps.sessionSecret, now);
      if (payload) await attach(node, client, payload, message.lastSeq);
      else fail(client, "invalid_token");
      return;
    }
    case "ping":
      send(client, { type: "pong", t: message.t, serverTime: now });
      return;
    case "lookup": {
      if (identity || client.joining) {
        fail(client, "forbidden");
        return;
      }
      const limitKey = `ratelimit:lookup:${client.ip}`;
      if (Number(await deps.redis.get(limitKey)) >= UNKNOWN_PINS_PER_MINUTE) {
        fail(client, "rate_limited");
        return;
      }
      const gameId = GameId.safeParse(await deps.redis.get(`pin:${message.pin}`));
      if (!gameId.success || !(await ensureGame(node, gameId.data))) {
        await deps.redis.incr(limitKey);
        await deps.redis.expire(limitKey, 60, "NX");
        fail(client, "game_not_found");
        return;
      }
      await attach(node, client, { role: "visitor", gameId: gameId.data });
      return;
    }
    case "join": {
      if (identity?.role !== "visitor" || client.joining) {
        fail(client, "forbidden");
        return;
      }
      const { gameId } = identity;
      const { nickname, team } = message;
      const command: Extract<Command, { type: "join" }> = {
        type: "join",
        at: now,
        playerId: PlayerId.parse(randomUUID()),
        nickname,
        newTeamId: TeamId.parse(randomUUID()),
        team,
      };
      client.joining = { gameId, playerId: command.playerId, teamId: joinedTeamId(command) };
      await addCommand(deps, gameId, command, client);
      return;
    }
    // Un choix, ou l'ordre d'une remise dans l'ordre : le moteur vérifie qu'il convient à la question.
    case "answer":
    case "order": {
      if (identity?.role !== "player") {
        fail(client, "forbidden");
        return;
      }
      await addCommand(deps, identity.gameId, { ...message, at: now, playerId: identity.playerId }, client);
      send(client, { type: "answer_received" });
      return;
    }
    case "start":
    case "next":
    case "end":
    case "kick": {
      if (identity?.role !== "host") {
        fail(client, "forbidden");
        return;
      }
      const command: Command =
        message.type === "kick" ? { type: "kick", at: now, playerId: message.playerId } : { type: message.type, at: now };
      await addCommand(deps, identity.gameId, command, client);
      return;
    }
  }
}

// Réponse du coordinateur à une commande de ce nœud : un refus, ou l'acceptation d'un `join`.
// Un visiteur dont le `join` est refusé le reste : il peut réessayer, et la liste des équipes reste à jour.
export async function handleReply(node: Node, { connId, result }: Reply): Promise<void> {
  const client = node.clients.get(connId);
  if (!client) return;
  const joining = client.joining;
  client.joining = undefined;
  if (!result.ok) {
    fail(client, result.error);
    return;
  }
  if (!joining) return;
  const token = signToken({ role: "player", ...joining }, node.deps.sessionSecret);
  send(client, { type: "welcome", token });
  await attach(node, client, { role: "player", ...joining });
}

async function attach(node: Node, client: Client, identity: Identity, lastSeq?: number): Promise<void> {
  const game = await ensureGame(node, identity.gameId);
  if (!game) {
    fail(client, "game_not_found");
    return;
  }
  client.identity = identity;
  client.log = node.deps.logger.child({
    connId: client.id,
    gameId: game.id,
    ...(identity.role === "player" && { playerId: identity.playerId }),
  });
  if (lastSeq !== undefined) {
    // Reconnexion : la diffusion lui renvoie les événements manqués, ou un snapshot s'ils ont été purgés du stream.
    client.position = lastSeq;
    game.clients.set(client, identity);
    return;
  }
  const state = await currentState(node.deps, game);
  if (!state) {
    fail(client, "game_not_found");
    return;
  }
  // Les événements diffusés pendant la lecture de l'état seront rattrapés à partir de cette position.
  const message = snapshot(state, identity);
  client.position = state.seq;
  game.clients.set(client, identity);
  send(client, message);
  if (message.type === "error") client.socket.close();
}

async function leave(node: Node, client: Client): Promise<void> {
  const gameId = client.identity?.gameId;
  const game = gameId && (await node.games.get(gameId));
  if (!game) return;
  game.clients.delete(client);
  await release(node, game);
}

function fail(client: Client, code: ErrorCode): void {
  send(client, { type: "error", code });
}
