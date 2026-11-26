import { afterAll, expect, test } from "vitest";
import { signUp, testApp } from "./testing.ts";

const app = testApp();
afterAll(() => app.close());

test("un animateur crée son compte puis retrouve sa session", async () => {
  const cookie = await signUp(app, "Camille");
  const response = await app.inject({ url: "/api/auth/get-session", headers: { cookie } });
  expect(response.json<unknown>()).toMatchObject({ user: { name: "Camille" } });
});

test("sans cookie, il n'y a pas de session", async () => {
  const response = await app.inject({ url: "/api/auth/get-session" });
  expect(response.json<unknown>()).toBeNull();
});
