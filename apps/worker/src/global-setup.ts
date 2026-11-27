import { applyMigrations, createDb } from "@quorum/db";
import { Redis } from "ioredis";
import { TEST_DATABASE_URL, TEST_REDIS_URL } from "./testing.ts";

// Base et Redis dédiés aux tests du worker, recréés à chaque lancement : ils tournent en même temps que ceux de l'API.
export default async function setup(): Promise<void> {
  const admin = createDb(TEST_DATABASE_URL.replace(/quorum_worker_test$/, "quorum"));
  await admin.$client.query("DROP DATABASE IF EXISTS quorum_worker_test WITH (FORCE)");
  await admin.$client.query("CREATE DATABASE quorum_worker_test");
  await admin.$client.end();

  const db = createDb(TEST_DATABASE_URL);
  await applyMigrations(db);
  await db.$client.end();

  const redis = new Redis(TEST_REDIS_URL);
  await redis.flushdb();
  redis.disconnect();
}
