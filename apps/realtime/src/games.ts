import { setTimeout as sleep } from "node:timers/promises";
import { Command, GameState, type Recipient } from "@quorum/game-engine";
import { ErrorCode, type GameId, type PlayerId, type ServerMessage } from "@quorum/protocol";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { WebSocket } from "ws";
import { z } from "zod";

export const GAME_TTL_SECONDS = 2 * 60 * 60;
const TICK_MS = 250;
const BLOCK_MS = 200;

export interface Deps {
  redis: Redis;
  nodeId: string;
  publicOrigin: string;
  sessionSecret: string;
  now: () => number;
  logger: Logger;
}

export type Identity = { role: "host"; gameId: GameId } | { role: "player"; gameId: GameId; playerId: PlayerId };

export interface Client {
  id: string;
  socket: WebSocket;
  ip: string;
  log: Logger;
  helloed: boolean;
  identity: Identity | undefined;
  joining: { gameId: GameId; playerId: PlayerId } | undefined;
  window: { start: number; count: number };
  // Les messages d'une connexion sont traités un par un, dans l'ordre d'arrivée.
  queue: Promise<void>;
}

// Phase 1 : un nœud coordonne et diffuse toutes les parties dont il sert un client (le lease arrive en phase 2).
export interface LocalGame {
  id: GameId;
  state: GameState;
  clients: Map<Client, Recipient>;
  cursor: string;
  tick: NodeJS.Timeout | undefined;
  log: Logger;
}

export interface Node {
  deps: Deps;
  clients: Map<string, Client>;
  games: Map<GameId, Promise<LocalGame | null>>;
}

export const CommandEntry = z.object({
  command: Command,
  replyTo: z.object({ nodeId: z.string(), connId: z.string() }).optional(),
});

export const Reply = z.object({
  connId: z.string(),
  result: z.discriminatedUnion("ok", [z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), error: ErrorCode })]),
});
export type Reply = z.infer<typeof Reply>;

export function keys(gameId: GameId) {
  return {
    state: `game:${gameId}:state`,
    events: `game:${gameId}:events`,
    commands: `game:${gameId}:commands`,
    owner: `game:${gameId}:owner`,
  };
}

export function parseJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return undefined;
  }
}

export function send(client: Client, message: ServerMessage): void {
  client.socket.send(JSON.stringify(message));
}

export function recipientOf(identity: Identity): Recipient {
  return identity.role === "host" ? { role: "host" } : { role: "player", playerId: identity.playerId };
}

export async function addCommand(deps: Deps, gameId: GameId, command: Command, replyTo?: Client): Promise<void> {
  const entry = { command, ...(replyTo && { replyTo: { nodeId: deps.nodeId, connId: replyTo.id } }) };
  await deps.redis.xadd(keys(gameId).commands, "*", "entry", JSON.stringify(entry));
}

// Le chargement est mémorisé sous forme de promesse : deux clients qui arrivent ensemble partagent la même partie.
export function ensureGame(node: Node, gameId: GameId): Promise<LocalGame | null> {
  const known = node.games.get(gameId);
  if (known) return known;
  const loading = loadGame(node, gameId);
  node.games.set(gameId, loading);
  void loading.then((game) => game ?? node.games.delete(gameId));
  return loading;
}

async function loadGame(node: Node, gameId: GameId): Promise<LocalGame | null> {
  const state = GameState.safeParse(parseJson((await node.deps.redis.get(keys(gameId).state)) ?? undefined));
  if (!state.success) return null;
  const log = node.deps.logger.child({ gameId });
  const game: LocalGame = { id: gameId, state: state.data, clients: new Map(), cursor: `${String(state.data.seq)}-0`, tick: undefined, log };
  scheduleTicks(node.deps, game);
  log.info("partie prise en charge");
  return game;
}

export function release(node: Node, game: LocalGame): void {
  const joining = [...node.clients.values()].some((client) => client.joining?.gameId === game.id);
  if (game.clients.size > 0 || joining) return;
  clearInterval(game.tick);
  node.games.delete(game.id);
  game.log.info("partie libérée");
}

export function scheduleTicks(deps: Deps, game: LocalGame): void {
  if (game.state.current.phase !== "question") {
    clearInterval(game.tick);
    game.tick = undefined;
    return;
  }
  game.tick ??= setInterval(() => {
    addCommand(deps, game.id, { type: "tick", at: deps.now() }).catch((error: unknown) => {
      game.log.error({ err: error }, "tick non envoyé");
    });
  }, TICK_MS);
}

export async function localGames(node: Node): Promise<LocalGame[]> {
  return (await Promise.all(node.games.values())).filter((game) => game !== null);
}

// Boucle XREAD BLOCK sur les streams des parties locales, avec sa propre connexion Redis (bloquante).
export function startLoop(
  node: Node,
  name: string,
  read: (redis: Redis, games: LocalGame[], blockMs: number) => Promise<void>,
): () => Promise<void> {
  const redis = node.deps.redis.duplicate();
  const stop = new AbortController();
  const loop = (async () => {
    while (!stop.signal.aborted) {
      try {
        const games = await localGames(node);
        if (games.length === 0) await sleep(BLOCK_MS);
        else await read(redis, games, BLOCK_MS);
      } catch (error) {
        node.deps.logger.error({ err: error }, `boucle ${name} interrompue`);
        await sleep(1000);
      }
    }
  })();
  return async () => {
    stop.abort();
    await loop;
    redis.disconnect();
  };
}
