import type { Question } from "@quorum/protocol";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Un quiz est toujours lu et enregistré en entier : ses questions tiennent dans une colonne jsonb (ADR 0009).
export const quizzes = pgTable(
  "quizzes",
  {
    id: uuid().primaryKey().defaultRandom(),
    // La clé étrangère vers `user` arrive avec les tables de Better Auth, dans la tâche api.
    ownerId: uuid().notNull(),
    title: text().notNull(),
    questions: jsonb().$type<Question[]>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index().on(table.ownerId)],
);
