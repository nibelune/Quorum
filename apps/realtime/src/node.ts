import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocketServer } from "ws";
import { startBroadcast } from "./broadcast.ts";
import { handleConnection, handleReply } from "./connection.ts";
import { startCoordinator } from "./coordinator.ts";
import { type Deps, localGames, type Node, parseJson, releaseLease, Reply } from "./games.ts";

const MAX_MESSAGE_BYTES = 4096;

export interface RealtimeNode {
  server: Server;
  // Arrêt progressif (SIGTERM) : les clients se reconnectent ailleurs, et un autre nœud reprend aussitôt les parties.
  shutdown: () => Promise<void>;
  // Arrêt immédiat, sans relâcher les leases : c'est ce que voit le reste du système quand un nœud tombe.
  close: () => Promise<void>;
}

export function startNode(deps: Deps): RealtimeNode {
  const node: Node = { deps, clients: new Map(), games: new Map() };
  // Au-delà de maxPayload, ws ferme la connexion avec le code 1009.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  const server = createServer((request, response) => {
    response.writeHead(request.url === "/health" ? 200 : 404).end();
  });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws" || request.headers.origin !== deps.publicOrigin) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleConnection(node, ws, request);
    });
  });

  const replies = deps.redis.duplicate();
  void replies.subscribe(`node:${deps.nodeId}:replies`);
  replies.on("message", (_channel: string, text: string) => {
    const reply = Reply.safeParse(parseJson(text));
    if (!reply.success) return;
    handleReply(node, reply.data).catch((error: unknown) => {
      deps.logger.error({ err: error }, "réponse non traitée");
    });
  });

  const stops = [startCoordinator(node), startBroadcast(node)];

  async function close(): Promise<void> {
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    server.close();
    await Promise.all(stops.map((stop) => stop()));
    for (const game of await localGames(node)) clearInterval(game.coordination?.tick);
    replies.disconnect();
  }

  return {
    server,
    async shutdown() {
      deps.logger.info("arrêt progressif");
      server.close();
      for (const game of await localGames(node)) await releaseLease(node, game);
      const closing = [...wss.clients].map((socket) => once(socket, "close"));
      for (const socket of wss.clients) socket.close(1012, "Redémarrage du service");
      await Promise.race([Promise.all(closing), sleep(2000)]);
      await close();
    },
    close,
  };
}
