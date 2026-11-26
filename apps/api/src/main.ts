import { hostname } from "node:os";
import { createDb } from "@quorum/db";
import { Redis } from "ioredis";
import { z } from "zod";
import { buildApp } from "./app.ts";
import { createAuth } from "./auth.ts";

const env = z
  .object({
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    PUBLIC_ORIGIN: z.url(),
    SESSION_SECRET: z.string().min(32),
    BETTER_AUTH_SECRET: z.string().min(32),
  })
  .parse(process.env);

const db = createDb(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL);
const auth = createAuth(db, { publicOrigin: env.PUBLIC_ORIGIN, secret: env.BETTER_AUTH_SECRET });
const app = buildApp({ db, redis, auth, sessionSecret: env.SESSION_SECRET }, { base: { nodeId: hostname() } });

app.addHook("onClose", async () => {
  await db.$client.end();
  redis.disconnect();
});
process.once("SIGTERM", () => void app.close());

// IPv4 et IPv6 : le réseau privé de Railway peut joindre le service par l'une ou l'autre.
await app.listen({ host: "::", port: 3000 });
