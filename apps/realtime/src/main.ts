import { hostname } from "node:os";
import { Redis } from "ioredis";
import { pino } from "pino";
import { z } from "zod";
import { startNode } from "./node.ts";

const env = z
  .object({ REDIS_URL: z.url(), PUBLIC_ORIGIN: z.url(), SESSION_SECRET: z.string().min(32) })
  .parse(process.env);

const nodeId = hostname();
const logger = pino({ base: { nodeId } });
const redis = new Redis(env.REDIS_URL);
const node = startNode({
  redis,
  nodeId,
  publicOrigin: new URL(env.PUBLIC_ORIGIN).origin,
  sessionSecret: env.SESSION_SECRET,
  now: () => Date.now(),
  logger,
  leaseMs: 5000,
});

node.server.listen(3000, () => {
  logger.info("realtime à l'écoute sur le port 3000");
});
process.once("SIGTERM", () => {
  void node.shutdown().then(() => {
    redis.disconnect();
  });
});
