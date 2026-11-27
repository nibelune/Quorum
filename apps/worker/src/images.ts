import { type Db, games, images, quizzes } from "@quorum/db";
import type { AwsClient } from "aws4fetch";
import { and, eq, lt, notExists, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Logger } from "pino";

export interface Deps {
  db: Db;
  // Bucket S3 des images (ADR 0013) : un client qui signe les requêtes, et l'URL du bucket.
  storage: { client: AwsClient; bucketUrl: string };
  logger: Logger;
}

// Un animateur peut avoir envoyé une image sans avoir encore enregistré son quiz : on lui laisse un jour.
const GRACE_MS = 24 * 60 * 60 * 1000;

// Les questions d'un quiz ou d'une partie utilisent-elles cette image ?
const uses = (questions: AnyPgColumn) =>
  sql`${questions} @> jsonb_build_array(jsonb_build_object('imageUrl', '/api/images/' || ${images.key}))`;

// Supprime du bucket les images qu'aucun quiz ni aucune partie n'utilise, puis les oublie.
export async function deleteOrphanImages({ db, storage, logger }: Deps, now: Date): Promise<void> {
  const orphans = await db
    .select({ key: images.key })
    .from(images)
    .where(
      and(
        lt(images.createdAt, new Date(now.getTime() - GRACE_MS)),
        notExists(db.select().from(quizzes).where(uses(quizzes.questions))),
        notExists(db.select().from(games).where(uses(games.questions))),
      ),
    );
  for (const { key } of orphans) {
    const response = await storage.client.fetch(`${storage.bucketUrl}/${key}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`Le stockage a refusé de supprimer ${key} : ${String(response.status)}`);
    await db.delete(images).where(eq(images.key, key));
  }
  logger.info({ deleted: orphans.length }, "images orphelines supprimées");
}
