import { setTimeout as sleep } from "node:timers/promises";
import { Command, GameState, type Recipient } from "@quorum/game-engine";
import { ErrorCode, type GameId, type PlayerId, type ServerMessage, type TeamId } from "@quorum/protocol";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { WebSocket } from "ws";
import { z } from "zod";

export const GAME_TTL_SECONDS = 2 * 60 * 60;
const BLOCK_MS = 200;

const RELEASE_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`;

export interface Deps {
  redis: Redis;
  nodeId: string;
  publicOrigin: string;
  sessionSecret: string;
  now: () => number;
  logger: Logger;
  // Durée de vie du lease de coordination (5 s en production, plus courte dans les tests).
  leaseMs: number;
}

// Le destinataire d'une connexion, et la partie qu'elle suit. Un visiteur a trouvé la partie par son PIN (`lookup`).
export type Identity = Recipient & { gameId: GameId };

export interface Client {
  id: string;
  socket: WebSocket;
  ip: string;
  log: Logger;
  helloed: boolean;
  identity: Identity | undefined;
  joining: { gameId: GameId; playerId: PlayerId; teamId: TeamId } | undefined;
  window: { start: number; count: number };
  // Dernier événement envoyé à ce client : la diffusion lui envoie la suite, dans l'ordre et sans trou.
  position: number;
  // Les messages d'une connexion sont traités un par un, dans l'ordre d'arrivée.
  queue: Promise<void>;
}

// Le nœud détient le lease de la partie : il applique les commandes et garde l'état en mémoire.
export interface Coordination {
  lease: string;
  state: GameState;
  tick: NodeJS.Timeout | undefined;
}

// Une partie dont le nœud sert au moins un client. Il diffuse ses événements, et la coordonne s'il obtient le lease.
export interface LocalGame {
  id: GameId;
  clients: Map<Client, Recipient>;
  cursor: string;
  coordination: Coordination | null;
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
    lease: `game:${gameId}:lease`,
    fence: `game:${gameId}:fence`,
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
  if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(message));
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
  const state = await readState(node.deps, gameId);
  if (!state) return null;
  const log = node.deps.logger.child({ gameId });
  log.info("partie servie");
  return { id: gameId, clients: new Map(), cursor: `${String(state.seq)}-0`, coordination: null, log };
}

export async function readState(deps: Deps, gameId: GameId): Promise<GameState | null> {
  const state = GameState.safeParse(parseJson((await deps.redis.get(keys(gameId).state)) ?? undefined));
  return state.success ? state.data : null;
}

// Le coordinateur a l'état le plus récent en mémoire ; les autres nœuds le lisent dans Redis.
export async function currentState(deps: Deps, game: LocalGame): Promise<GameState | null> {
  return game.coordination?.state ?? readState(deps, game.id);
}

export function dropCoordination(game: LocalGame, reason: string): void {
  if (!game.coordination) return;
  clearInterval(game.coordination.tick);
  game.coordination = null;
  game.log.info(reason);
}

// Relâché seulement si le token correspond : un autre nœud peut reprendre la partie aussitôt, sans attendre l'expiration.
export async function releaseLease(node: Node, game: LocalGame): Promise<void> {
  const lease = game.coordination?.lease;
  dropCoordination(game, "lease relâché");
  if (lease) await node.deps.redis.eval(RELEASE_SCRIPT, 1, keys(game.id).lease, lease);
}

// Plus aucun client ici : le nœud cesse de servir la partie.
export async function release(node: Node, game: LocalGame): Promise<void> {
  if (game.clients.size > 0) return;
  node.games.delete(game.id);
  game.log.info("partie libérée");
  await releaseLease(node, game);
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
