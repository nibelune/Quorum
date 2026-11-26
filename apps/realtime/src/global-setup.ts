import { Redis } from "ioredis";
import { TEST_REDIS_URL } from "./testing.ts";

// Base Redis dédiée aux tests de realtime : l'API utilise la n° 1, et turbo lance les deux en parallèle.
export default async function setup(): Promise<void> {
  const redis = new Redis(TEST_REDIS_URL);
  await redis.flushdb();
  redis.disconnect();
}
