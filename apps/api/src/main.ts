import { hostname } from "node:os";
import { createDb } from "@quorum/db";
import { AwsClient } from "aws4fetch";
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
    // URL du bucket, adressé par chemin : {endpoint}/{bucket}.
    S3_BUCKET_URL: z.url(),
    S3_REGION: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
  })
  .parse(process.env);

const db = createDb(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL);
const auth = createAuth(db, { publicOrigin: env.PUBLIC_ORIGIN, secret: env.BETTER_AUTH_SECRET });
const storage = {
  client: new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    region: env.S3_REGION,
    service: "s3",
  }),
  bucketUrl: env.S3_BUCKET_URL,
};
const app = buildApp({ db, redis, auth, sessionSecret: env.SESSION_SECRET, storage }, { base: { nodeId: hostname() } });

app.addHook("onClose", async () => {
  await db.$client.end();
  redis.disconnect();
});
process.once("SIGTERM", () => void app.close());

// IPv4 et IPv6 : le réseau privé de Railway peut joindre le service par l'une ou l'autre.
await app.listen({ host: "::", port: 3000 });
