import { type Db, users } from "@quorum/db";
import { AwsClient } from "aws4fetch";

export const TEST_DATABASE_URL = "postgres://quorum:quorum@localhost:5432/quorum_worker_test";
export const TEST_REDIS_URL = "redis://localhost:6379/3";
// Le serveur S3 local du Compose, qui accepte n'importe quelles clés.
export const TEST_STORAGE = {
  client: new AwsClient({ accessKeyId: "test", secretAccessKey: "test", region: "us-east-1", service: "s3" }),
  bucketUrl: "http://localhost:9090/quorum",
};

export async function createOwner(db: Db): Promise<string> {
  const [owner] = await db.insert(users).values({ name: "Animateur", email: `${crypto.randomUUID()}@quorum.test` }).returning();
  if (!owner) throw new Error("Animateur non créé");
  return owner.id;
}
