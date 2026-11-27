import { z } from "zod";
import { GameId } from "./domain.ts";

// File BullMQ partagée : realtime y ajoute les tâches, le worker les exécute (ADR 0014).
export const JOBS_QUEUE = "jobs";

// Fin de partie : copier ses résultats de Redis vers Postgres.
export const PERSIST_GAME = "persist-game";
export const PersistGame = z.object({ gameId: GameId });
export type PersistGame = z.infer<typeof PersistGame>;

// Chaque nuit : supprimer les images qu'aucun quiz ni aucune partie n'utilise plus.
export const DELETE_ORPHAN_IMAGES = "delete-orphan-images";
