import { createDb, games, images, quizzes } from "@quorum/db";
import { Question } from "@quorum/protocol";
import { inArray } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, expect, test } from "vitest";
import { deleteOrphanImages } from "./images.ts";
import { createOwner, TEST_DATABASE_URL, TEST_STORAGE } from "./testing.ts";

const db = createDb(TEST_DATABASE_URL);
const deps = { db, storage: TEST_STORAGE, logger: pino({ level: "silent" }) };
const now = new Date("2026-11-27T04:00:00Z");
const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
const anHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
let ownerId: string;

beforeAll(async () => {
  ownerId = await createOwner(db);
});
afterAll(() => db.$client.end());

// Une image envoyée dans le bucket et inscrite en base, comme le fait l'API.
async function upload(createdAt: Date): Promise<string> {
  const key = `${crypto.randomUUID()}.png`;
  await TEST_STORAGE.client.fetch(`${TEST_STORAGE.bucketUrl}/${key}`, { method: "PUT", body: "png", headers: { "content-type": "image/png" } });
  await db.insert(images).values({ key, createdAt });
  return key;
}

const illustrated = (key: string) =>
  Question.parse({
    id: crypto.randomUUID(),
    text: "Quelle est cette planète ?",
    choices: ["Saturne", "Jupiter"],
    correctIndex: 0,
    durationSec: 20,
    imageUrl: `/api/images/${key}`,
  });

test("supprime les images de plus d'un jour qu'aucun quiz ni aucune partie n'utilise", async () => {
  const orphan = await upload(twoDaysAgo);
  const inQuiz = await upload(twoDaysAgo);
  const inGame = await upload(twoDaysAgo);
  const recent = await upload(anHourAgo);
  await db.insert(quizzes).values({ ownerId, title: "Planètes", questions: [illustrated(inQuiz)] });
  // Le quiz a été modifié depuis, mais la partie jouée garde son image.
  await db.insert(games).values({ id: crypto.randomUUID(), ownerId, title: "Planètes", mode: "solo", questions: [illustrated(inGame)] });

  await deleteOrphanImages(deps, now);

  const kept = await db.select({ key: images.key }).from(images).where(inArray(images.key, [orphan, inQuiz, inGame, recent]));
  expect(kept.map(({ key }) => key).toSorted()).toEqual([inQuiz, inGame, recent].toSorted());
  expect((await TEST_STORAGE.client.fetch(`${TEST_STORAGE.bucketUrl}/${orphan}`)).status).toBe(404);
  expect((await TEST_STORAGE.client.fetch(`${TEST_STORAGE.bucketUrl}/${inQuiz}`)).status).toBe(200);
});
