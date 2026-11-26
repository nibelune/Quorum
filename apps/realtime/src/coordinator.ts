import { readFileSync } from "node:fs";
import { type GameEvent, type GameState, reduce } from "@quorum/game-engine";
import {
  CommandEntry,
  GAME_TTL_SECONDS,
  keys,
  type LocalGame,
  type Node,
  parseJson,
  type Reply,
  scheduleTicks,
  startLoop,
} from "./games.ts";

const COMMIT_SCRIPT = readFileSync(new URL("commit.lua", import.meta.url), "utf8");
const BATCH_SIZE = 100;

// Les commandes appliquées sont supprimées par `commit` : le stream ne contient que des commandes en attente, lues depuis le début.
export function startCoordinator(node: Node): () => Promise<void> {
  return startLoop(node, "du coordinateur", async (redis, games, blockMs) => {
    const commandStreams = games.map((game) => keys(game.id).commands);
    const streams = await redis.xread(
      "COUNT",
      BATCH_SIZE,
      "BLOCK",
      blockMs,
      "STREAMS",
      ...commandStreams,
      ...games.map(() => "0"),
    );
    for (const [stream, entries] of streams ?? []) {
      const game = games.find((candidate) => keys(candidate.id).commands === stream);
      if (game) await coordinate(node, game, entries);
    }
  });
}

async function coordinate(node: Node, game: LocalGame, entries: [id: string, fields: string[]][]): Promise<void> {
  let state = game.state;
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
  await commit(node, game, state, events, lastId);
  if (state.current.phase !== game.state.current.phase) game.log.info({ phase: state.current.phase }, "transition");
  game.state = state;
  scheduleTicks(node.deps, game);
  for (const { nodeId, connId, result } of replies) {
    await node.deps.redis.publish(`node:${nodeId}:replies`, JSON.stringify({ connId, result }));
  }
}

async function commit(node: Node, game: LocalGame, state: GameState, events: GameEvent[], lastId: string): Promise<void> {
  const { state: stateKey, events: eventsKey, commands, owner } = keys(game.id);
  const [time = "0", sequence = "0"] = lastId.split("-");
  await node.deps.redis.eval(
    COMMIT_SCRIPT,
    5,
    stateKey,
    eventsKey,
    commands,
    `pin:${state.pin}`,
    owner,
    JSON.stringify(state),
    `${time}-${String(Number(sequence) + 1)}`,
    GAME_TTL_SECONDS,
    ...events.flatMap((event) => [`${String(event.seq)}-0`, JSON.stringify(event)]),
  );
}
