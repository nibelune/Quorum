import type { GameMode, Question } from "@quorum/protocol";
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth-schema.ts";

export * from "./auth-schema.ts";

// Un quiz est toujours lu et enregistré en entier : ses questions tiennent dans une colonne jsonb (ADR 0009).
export const quizzes = pgTable(
  "quizzes",
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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

// Une partie, créée par l'API à son lancement. Le worker y ajoute les résultats une fois la partie terminée (ADR 0014).
export const games = pgTable(
  "games",
  {
    id: uuid().primaryKey(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Le quiz peut être modifié ou supprimé ensuite : la partie garde son titre et ses questions.
    quizId: uuid().references(() => quizzes.id, { onDelete: "set null" }),
    title: text().notNull(),
    mode: text().$type<GameMode>().notNull(),
    // Les questions telles qu'elles ont été jouées, choix mélangés : les réponses s'y réfèrent par position.
    questions: jsonb().$type<Question[]>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp({ withTimezone: true }),
  },
  (table) => [index().on(table.ownerId)],
);

// En solo, chaque joueur forme une équipe d'un membre, à son nom.
export const gameTeams = pgTable(
  "game_teams",
  {
    gameId: uuid()
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    teamId: uuid().notNull(),
    name: text().notNull(),
    score: integer().notNull(),
    // L'ordre de création des équipes, qui départage les égalités comme pendant la partie.
    position: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.teamId] })],
);

export const gamePlayers = pgTable(
  "game_players",
  {
    gameId: uuid()
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: uuid().notNull(),
    nickname: text().notNull(),
    teamId: uuid().notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.playerId] })],
);

// Une ligne par question et par équipe qui a répondu.
export const gameAnswers = pgTable(
  "game_answers",
  {
    gameId: uuid()
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    questionId: uuid().notNull(),
    teamId: uuid().notNull(),
    choiceIndex: integer().notNull(),
    responseMs: integer().notNull(),
    points: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.questionId, table.teamId] })],
);

// Les images envoyées (ADR 0013), pour que le worker supprime celles qu'aucun quiz ni aucune partie n'utilise.
export const images = pgTable("images", {
  key: text().primaryKey(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
