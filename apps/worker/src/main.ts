import { createDb } from "@quorum/db";
import { DELETE_ORPHAN_IMAGES, JOBS_QUEUE, PERSIST_GAME, PersistGame } from "@quorum/protocol";
import { AwsClient } from "aws4fetch";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { pino } from "pino";
import { z } from "zod";
import { deleteOrphanImages } from "./images.ts";
import { persistGame } from "./persist.ts";

const env = z
  .object({
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    // URL du bucket, adressé par chemin : {endpoint}/{bucket}.
    S3_BUCKET_URL: z.url(),
    S3_REGION: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
  })
  .parse(process.env);

const logger = pino();
const db = createDb(env.DATABASE_URL);
// BullMQ attend ses tâches par des commandes bloquantes : elles ne doivent pas échouer après quelques tentatives.
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const storage = {
  client: new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    region: env.S3_REGION,
    service: "s3",
  }),
  bucketUrl: env.S3_BUCKET_URL,
};

// Chaque nuit à 4 h (UTC). Enregistrer la planification une deuxième fois la met simplement à jour.
const queue = new Queue(JOBS_QUEUE, { connection: redis });
await queue.upsertJobScheduler(DELETE_ORPHAN_IMAGES, { pattern: "0 4 * * *" }, { name: DELETE_ORPHAN_IMAGES });

const worker = new Worker(
  JOBS_QUEUE,
  async (job) => {
    switch (job.name) {
      // L'heure de fin est celle où realtime a ajouté la tâche, pas celle où elle s'exécute.
      case PERSIST_GAME:
        return persistGame({ db, redis, logger }, PersistGame.parse(job.data).gameId, new Date(job.timestamp));
      case DELETE_ORPHAN_IMAGES:
        return deleteOrphanImages({ db, storage, logger }, new Date());
      default:
        throw new Error(`Tâche inconnue : ${job.name}`);
    }
  },
  { connection: redis },
);
worker.on("failed", (job, error) => {
  logger.error({ err: error, jobId: job?.id, attempts: job?.attemptsMade }, "tâche en échec");
});
logger.info("worker démarré");

// Arrêt progressif : la tâche en cours se termine avant la fermeture des connexions.
process.once("SIGTERM", () => {
  void Promise.all([worker.close(), queue.close()]).then(async () => {
    await db.$client.end();
    redis.disconnect();
  });
});
