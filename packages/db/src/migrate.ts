import { z } from "zod";
import { applyMigrations, createDb } from "./index.ts";

const env = z.object({ DATABASE_URL: z.url() }).parse(process.env);

const db = createDb(env.DATABASE_URL);
await applyMigrations(db);
await db.$client.end();
