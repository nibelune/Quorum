import { createDb, images } from "@quorum/db";
import { MAX_IMAGE_BYTES, UploadedImage } from "@quorum/protocol";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { signUp, TEST_DATABASE_URL, testApp } from "./testing.ts";

const app = testApp();
const db = createDb(TEST_DATABASE_URL);
let cookie: string;
// Les premiers octets d'un PNG : le serveur ne décode pas l'image, il la range et la rend telle quelle.
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

beforeAll(async () => {
  cookie = await signUp(app);
});
afterAll(async () => {
  await db.$client.end();
  await app.close();
});

function upload(body: Buffer, type: string, as = cookie) {
  return app.inject({ method: "POST", url: "/api/images", headers: { cookie: as, "content-type": type }, payload: body });
}

test("un animateur envoie une image, que tout le monde peut ensuite lire et garder en cache", async () => {
  const response = await upload(png, "image/png");
  expect(response.statusCode).toBe(201);
  const { url } = UploadedImage.parse(response.json());

  const image = await app.inject({ method: "GET", url });
  expect(image.statusCode).toBe(200);
  expect(image.rawPayload).toEqual(png);
  expect(image.headers).toMatchObject({
    "content-type": "image/png",
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  // Inscrite en base : le worker la supprimera si aucun quiz ne l'utilise.
  expect(await db.select().from(images).where(eq(images.key, url.slice("/api/images/".length)))).toHaveLength(1);
});

test.each([
  ["sans session", () => upload(png, "image/png", ""), 401],
  ["au format SVG", () => upload(Buffer.from("<svg/>"), "image/svg+xml"), 415],
  ["de plus de 2 Mo", () => upload(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/jpeg"), 413],
])("refuse une image %s", async (_, send, status) => {
  expect((await send()).statusCode).toBe(status);
});

test("une image inconnue n'existe pas", async () => {
  const response = await app.inject({ method: "GET", url: `/api/images/${crypto.randomUUID()}.png` });
  expect(response.statusCode).toBe(404);
});
