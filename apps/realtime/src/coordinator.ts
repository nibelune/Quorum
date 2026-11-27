import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { type GameEvent, type GameState, reduce } from "@quorum/game-engine";
import { PERSIST_GAME } from "@quorum/protocol";
import {
  addCommand,
  CommandEntry,
  type Coordination,
  dropCoordination,
  GAME_TTL_SECONDS,
  keys,
  type LocalGame,
  localGames,
  type Node,
  parseJson,
  readState,
  type Reply,
  startLoop,
} from "./games.ts";

const COMMIT_SCRIPT = readFileSync(new URL("commit.lua", import.meta.url), "utf8");
const BATCH_SIZE = 100;
const TICK_MS = 250;

// Le lease est libre : on l'acquiert avec un nouveau token, tiré du compteur de fencing.
const ACQUIRE_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then return false end
local token = redis.call("INCR", KEYS[2])
redis.call("EXPIRE", KEYS[2], ARGV[3])
redis.call("SET", KEYS[1], ARGV[1] .. ":" .. token, "PX", ARGV[2])
return token`;

const RENEW_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) end return 0`;

export function startCoordinator(node: Node): () => Promise<void> {
  // Renouvelé bien avant son expiration : une pause du processus ne suffit pas à le perdre.
  const leases = setInterval(() => {
    maintainLeases(node).catch((error: unknown) => {
      node.deps.logger.error({ err: error }, "leases non entretenus");
    });
  }, node.deps.leaseMs * 0.3);

  // Les commandes appliquées sont supprimées par `commit` : le stream ne contient que des commandes en attente, lues depuis le début.
  const stopCommands = startLoop(node, "du coordinateur", async (redis, games, blockMs) => {
    const coordinated = games.filter((game) => game.coordination);
    if (coordinated.length === 0) {
      await sleep(blockMs);
      return;
    }
    const streams = await redis.xread(
      "COUNT",
      BATCH_SIZE,
      "BLOCK",
      blockMs,
      "STREAMS",
      ...coordinated.map((game) => keys(game.id).commands),
      ...coordinated.map(() => "0"),
    );
    for (const [stream, entries] of streams ?? []) {
      const game = coordinated.find((candidate) => keys(candidate.id).commands === stream);
      if (game?.coordination) await coordinate(node, game, game.coordination, entries);
    }
  });

  return async () => {
    clearInterval(leases);
    await stopCommands();
  };
}

async function maintainLeases(node: Node): Promise<void> {
  const { redis, nodeId, leaseMs } = node.deps;
  for (const game of await localGames(node)) {
    const { lease, fence } = keys(game.id);
    if (game.coordination) {
      const renewed = await redis.eval(RENEW_SCRIPT, 1, lease, game.coordination.lease, leaseMs);
      if (renewed === 0) dropCoordination(game, "lease perdu");
      continue;
    }
    const token = await redis.eval(ACQUIRE_SCRIPT, 2, lease, fence, nodeId, leaseMs, GAME_TTL_SECONDS);
    if (typeof token !== "number") continue;
    // Le nouveau coordinateur repart de l'état écrit par le précédent ; les commandes restées dans le stream seront appliquées.
    const state = await readState(node.deps, game.id);
    if (!state) continue;
    game.coordination = { lease: `${nodeId}:${String(token)}`, state, tick: undefined };
    scheduleTicks(node, game, game.coordination);
    game.log.info({ lease: game.coordination.lease }, "lease acquis");
    // Le coordinateur précédent a pu tomber entre le commit de la fin de partie et l'ajout de la tâche.
    if (state.current.phase === "ended") await persistResults(node, game);
  }
}

async function coordinate(
  node: Node,
  game: LocalGame,
  coordination: Coordination,
  entries: [id: string, fields: string[]][],
): Promise<void> {
  let state = coordination.state;
  const events: GameEvent[] = [];
  const replies: (Reply & { nodeId: string })[] = [];
  for (const [, fields] of entries) {
    const entry = CommandEntry.safeParse(parseJson(fields[1]));
    if (!entry.success) {
      game.log.error({ fields }, "commande illisible ignorée");
      continue;
    }
    const { command, replyTo } = entry.data;
    const result = reduce(state, command);
    if (result.ok) {
      state = result.state;
      events.push(...result.events);
    }
    // Seuls un refus et un `join` accepté appellent une réponse individuelle : le reste se voit dans les événements.
    if (replyTo && (!result.ok || command.type === "join")) {
      replies.push({ ...replyTo, result: result.ok ? { ok: true } : { ok: false, error: result.error } });
    }
  }

  const lastId = entries.at(-1)?.[0] ?? "0-0";
  try {
    await commit(node, game, coordination.lease, state, events, lastId);
  } catch (error) {
    // Un autre nœud a pris le lease : rien n'a été écrit, il appliquera lui-même ces commandes.
    if (!(error instanceof Error && error.message.includes("LEASE_LOST"))) throw error;
    if (game.coordination === coordination) dropCoordination(game, "lease perdu au commit");
    return;
  }

  if (state.current.phase !== coordination.state.current.phase) game.log.info({ phase: state.current.phase }, "transition");
  if (events.some(({ type }) => type === "game_ended")) await persistResults(node, game);
  coordination.state = state;
  if (game.coordination === coordination) scheduleTicks(node, game, coordination);
  // Un seul aller-retour vers Redis pour toutes les réponses du lot. `exec` ne rejette pas : chaque commande rend son erreur.
  const pipeline = node.deps.redis.pipeline();
  for (const { nodeId, connId, result } of replies) pipeline.publish(`node:${nodeId}:replies`, JSON.stringify({ connId, result }));
  for (const [error] of (await pipeline.exec()) ?? []) if (error) throw error;
}

async function commit(node: Node, game: LocalGame, lease: string, state: GameState, events: GameEvent[], lastId: string): Promise<void> {
  const gameKeys = keys(game.id);
  const [time = "0", sequence = "0"] = lastId.split("-");
  // Le stream des événements est plafonné : les fins de question sont aussi archivées, pour les résultats de la partie.
  const archived = events.filter(({ type }) => type === "question_ended").map((event) => JSON.stringify(event));
  await node.deps.redis.eval(
    COMMIT_SCRIPT,
    8,
    gameKeys.lease,
    gameKeys.state,
    gameKeys.events,
    gameKeys.commands,
    `pin:${state.pin}`,
    gameKeys.owner,
    gameKeys.fence,
    gameKeys.rounds,
    lease,
    JSON.stringify(state),
    `${time}-${String(Number(sequence) + 1)}`,
    GAME_TTL_SECONDS,
    archived.length,
    ...archived,
    ...events.flatMap((event) => [`${String(event.seq)}-0`, JSON.stringify(event)]),
  );
}

// Le worker copie les résultats dans Postgres. La tâche porte l'identifiant de la partie : BullMQ ignore un doublon.
async function persistResults(node: Node, game: LocalGame): Promise<void> {
  await node.deps.jobs.add(
    PERSIST_GAME,
    { gameId: game.id },
    {
      jobId: game.id,
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    },
  );
  game.log.info("résultats à enregistrer");
}

// Le chrono ne tourne que chez le coordinateur, et seulement pendant une question.
function scheduleTicks(node: Node, game: LocalGame, coordination: Coordination): void {
  if (coordination.state.current.phase !== "question") {
    clearInterval(coordination.tick);
    coordination.tick = undefined;
    return;
  }
  coordination.tick ??= setInterval(() => {
    addCommand(node.deps, game.id, { type: "tick", at: node.deps.now() }).catch((error: unknown) => {
      game.log.error({ err: error }, "tick non envoyé");
    });
  }, TICK_MS);
}
