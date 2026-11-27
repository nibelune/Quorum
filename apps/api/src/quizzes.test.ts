import { Quiz, type QuizInput, QuizSummary } from "@quorum/protocol";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { signUp, testApp } from "./testing.ts";

const app = testApp();
let cookie: string;
beforeAll(async () => {
  cookie = await signUp(app);
});
afterAll(() => app.close());

const capital = { kind: "choice" as const, text: "Quelle est la capitale de l'Australie ?", choices: ["Sydney", "Canberra"], correctIndex: 1, durationSec: 20 };
const input = (title: string, questions: QuizInput["questions"] = [capital]): QuizInput => ({ title, questions });

async function createQuiz(body: QuizInput, as = cookie) {
  const response = await app.inject({ method: "POST", url: "/api/quizzes", headers: { cookie: as }, payload: body });
  return Quiz.parse(response.json());
}

// `Quiz.parse` exige un UUID pour chaque question : il vérifie aussi que le serveur en a attribué un.
test("crée un quiz et attribue un identifiant à chaque nouvelle question", async () => {
  const quiz = await createQuiz(input("Capitales"));
  expect(quiz).toMatchObject({ title: "Capitales", questions: [capital] });
  const read = await app.inject({ url: `/api/quizzes/${quiz.id}`, headers: { cookie } });
  expect(read.json<unknown>()).toEqual(quiz);
});

test("enregistre un sondage, qui n'a pas de bonne réponse", async () => {
  const poll = { kind: "poll" as const, text: "Quelle planète préférez-vous ?", choices: ["Mars", "Saturne"], durationSec: 20 };
  expect(await createQuiz(input("Préférences", [poll]))).toMatchObject({ questions: [poll] });
});

test("liste les quiz de l'animateur, du plus récemment modifié au plus ancien", async () => {
  const own = await signUp(app);
  await createQuiz(input("Ancien"), own);
  await createQuiz(input("Récent", [capital, capital]), own);
  const response = await app.inject({ url: "/api/quizzes", headers: { cookie: own } });
  expect(z.array(QuizSummary).parse(response.json()).map(({ title, questionCount }) => ({ title, questionCount }))).toEqual([
    { title: "Récent", questionCount: 2 },
    { title: "Ancien", questionCount: 1 },
  ]);
});

test("une modification garde l'identifiant des questions existantes", async () => {
  const quiz = await createQuiz(input("Avant"));
  const kept = quiz.questions[0];
  const response = await app.inject({
    method: "PUT",
    url: `/api/quizzes/${quiz.id}`,
    headers: { cookie },
    payload: input("Après", [{ ...capital, id: kept?.id }, { ...capital, text: "Nouvelle question" }]),
  });
  const updated = Quiz.parse(response.json());
  expect(updated.title).toBe("Après");
  expect(updated.questions[0]?.id).toBe(kept?.id);
  expect(updated.questions[1]?.id).not.toBe(kept?.id);
});

test("supprime un quiz", async () => {
  const quiz = await createQuiz(input("À supprimer"));
  const deleted = await app.inject({ method: "DELETE", url: `/api/quizzes/${quiz.id}`, headers: { cookie } });
  expect(deleted.statusCode).toBe(204);
  expect((await app.inject({ url: `/api/quizzes/${quiz.id}`, headers: { cookie } })).statusCode).toBe(404);
});

test.each(["GET", "PUT", "DELETE"] as const)("%s sur le quiz d'un autre animateur répond 404", async (method) => {
  const quiz = await createQuiz(input("Privé"));
  const other = await signUp(app);
  const response = await app.inject({ method, url: `/api/quizzes/${quiz.id}`, headers: { cookie: other }, payload: input("Volé") });
  expect(response.statusCode).toBe(404);
});

test.each([
  ["un titre vide", input("   ")],
  ["aucune question", input("Vide", [])],
  ["une bonne réponse hors des choix", input("Faux", [{ ...capital, correctIndex: 2 }])],
])("refuse un quiz avec %s", async (_, body) => {
  const response = await app.inject({ method: "POST", url: "/api/quizzes", headers: { cookie }, payload: body });
  expect(response.statusCode).toBe(400);
});

test("sans session, les routes de l'animateur répondent 401", async () => {
  expect((await app.inject({ url: "/api/quizzes" })).statusCode).toBe(401);
  expect((await app.inject({ method: "POST", url: "/api/games", payload: {} })).statusCode).toBe(401);
});
