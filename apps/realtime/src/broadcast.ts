import { GameEvent, project, type Recipient, snapshot } from "@quorum/game-engine";
import type { Redis } from "ioredis";
import { type Client, currentState, keys, type LocalGame, type Node, parseJson, send, startLoop } from "./games.ts";

const BATCH_SIZE = 100;

// Seule cette boucle envoie les événements aux clients : chacun les reçoit dans l'ordre, à partir de sa position.
export function startBroadcast(node: Node): () => Promise<void> {
  return startLoop(node, "de diffusion", async (redis, games, blockMs) => {
    const streams = await redis.xread(
      "COUNT",
      BATCH_SIZE,
      "BLOCK",
      blockMs,
      "STREAMS",
      ...games.map((game) => keys(game.id).events),
      ...games.map((game) => game.cursor),
    );
    for (const [stream, entries] of streams ?? []) {
      const game = games.find((candidate) => keys(candidate.id).events === stream);
      if (!game) continue;
      for (const [id, fields] of entries) {
        game.cursor = id;
        const event = parseEvent(game, id, fields);
        if (!event) continue;
        for (const [client, recipient] of game.clients) deliver(client, recipient, event);
      }
    }
    for (const game of games) await catchUp(node, redis, game);
  });
}

// Un client en retard (reconnexion, ou snapshot plus ancien que la diffusion) relit les événements manqués dans le stream.
async function catchUp(node: Node, redis: Redis, game: LocalGame): Promise<void> {
  const head = Number(game.cursor.split("-")[0]);
  for (const [client, recipient] of game.clients) {
    if (client.position >= head) continue;
    const from = `${String(client.position + 1)}-0`;
    const entries = await redis.xrange(keys(game.id).events, from, game.cursor);
    if (entries[0]?.[0] === from) {
      for (const [id, fields] of entries) {
        const event = parseEvent(game, id, fields);
        if (event) deliver(client, recipient, event);
      }
      continue;
    }
    // Les événements manquants ont été purgés du stream : le client repart d'un snapshot.
    const state = await currentState(node.deps, game);
    if (!state) continue;
    client.position = state.seq;
    sendOrClose(client, snapshot(state, recipient));
  }
}

function deliver(client: Client, recipient: Recipient, event: GameEvent): void {
  if (event.seq !== client.position + 1) return;
  client.position = event.seq;
  const message = project(event, recipient);
  if (message) sendOrClose(client, message);
}

// `kicked` est le seul message d'erreur diffusé : le joueur exclu est ensuite déconnecté.
function sendOrClose(client: Client, message: NonNullable<ReturnType<typeof project>>): void {
  send(client, message);
  if (message.type === "error") client.socket.close();
}

function parseEvent(game: LocalGame, id: string, fields: string[]): GameEvent | null {
  const event = GameEvent.safeParse(parseJson(fields[1]));
  if (event.success) return event.data;
  game.log.error({ id }, "événement illisible ignoré");
  return null;
}
