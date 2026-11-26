import { GameEvent, project } from "@quorum/game-engine";
import { keys, type Node, parseJson, send, startLoop } from "./games.ts";

const BATCH_SIZE = 100;

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
        const event = GameEvent.safeParse(parseJson(fields[1]));
        if (!event.success) {
          game.log.error({ id }, "événement illisible ignoré");
          continue;
        }
        for (const [client, recipient] of game.clients) {
          const message = project(event.data, recipient);
          if (!message) continue;
          send(client, message);
          if (message.type === "error") client.socket.close();
        }
      }
    }
  });
}
