import { createDb } from "@quorum/db";
import { Redis } from "ioredis";
import { buildApp } from "./app.ts";
import { createAuth } from "./auth.ts";

export const TEST_DATABASE_URL = "postgres://quorum:quorum@localhost:5432/quorum_test";
export const TEST_REDIS_URL = "redis://localhost:6379/1";
export const TEST_SECRET = "secret-de-test-".padEnd(32, "x");

export type TestApp = ReturnType<typeof buildApp>;

export function testApp(): TestApp {
  const db = createDb(TEST_DATABASE_URL);
  const redis = new Redis(TEST_REDIS_URL);
  const auth = createAuth(db, { publicOrigin: "http://localhost:8080", secret: TEST_SECRET });
  const app = buildApp({ db, redis, auth, sessionSecret: TEST_SECRET });
  app.addHook("onClose", async () => {
    await db.$client.end();
    redis.disconnect();
  });
  return app;
}

// Crée un animateur et renvoie le cookie de sa session.
export async function signUp(app: TestApp, name = "Animateur"): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email: `${crypto.randomUUID()}@quorum.test`, password: "un-mot-de-passe-solide", name },
  });
  const cookie = response.cookies.find(({ name }) => name === "better-auth.session_token");
  if (!cookie) throw new Error(`Inscription refusée : ${response.body}`);
  return `${cookie.name}=${cookie.value}`;
}
