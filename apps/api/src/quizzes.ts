import { quizzes } from "@quorum/db";
import { Quiz, QuizId, QuizInput, QuizSummary, QuestionId } from "@quorum/protocol";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "./app.ts";

const params = z.object({ id: QuizId });
const notFound = { 404: z.null() };
const columns = { id: quizzes.id, title: quizzes.title, questions: quizzes.questions };

export function quizRoutes(app: FastifyInstance, { db }: Deps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const ownQuiz = (id: string, userId: string) => and(eq(quizzes.id, id), eq(quizzes.ownerId, userId));

  api.get("/api/quizzes", { schema: { response: { 200: z.array(QuizSummary) } } }, async (request) => {
    const rows = await db
      .select({
        id: quizzes.id,
        title: quizzes.title,
        questionCount: sql<number>`jsonb_array_length(${quizzes.questions})`,
        updatedAt: quizzes.updatedAt,
      })
      .from(quizzes)
      .where(eq(quizzes.ownerId, request.userId))
      .orderBy(desc(quizzes.updatedAt));
    return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  });

  api.get("/api/quizzes/:id", { schema: { params, response: { 200: Quiz, ...notFound } } }, async (request, reply) => {
    const [quiz] = await db.select(columns).from(quizzes).where(ownQuiz(request.params.id, request.userId));
    return quiz ?? reply.code(404).send(null);
  });

  api.post("/api/quizzes", { schema: { body: QuizInput, response: { 201: Quiz } } }, async (request, reply) => {
    const quiz = { id: crypto.randomUUID(), title: request.body.title, questions: withIds(request.body.questions) };
    await db.insert(quizzes).values({ ...quiz, ownerId: request.userId });
    return reply.code(201).send(quiz);
  });

  api.put("/api/quizzes/:id", { schema: { params, body: QuizInput, response: { 200: Quiz, ...notFound } } }, async (request, reply) => {
    const [quiz] = await db
      .update(quizzes)
      .set({ title: request.body.title, questions: withIds(request.body.questions) })
      .where(ownQuiz(request.params.id, request.userId))
      .returning(columns);
    return quiz ?? reply.code(404).send(null);
  });

  api.delete("/api/quizzes/:id", { schema: { params } }, async (request, reply) => {
    const deleted = await db.delete(quizzes).where(ownQuiz(request.params.id, request.userId)).returning(columns);
    return reply.code(deleted.length > 0 ? 204 : 404).send();
  });
}

function withIds(questions: QuizInput["questions"]) {
  return questions.map((question) => ({ ...question, id: question.id ?? QuestionId.parse(crypto.randomUUID()) }));
}
