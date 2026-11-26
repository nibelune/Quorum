import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import { createDb } from "./index.ts";

const env = z.object({ DATABASE_URL: z.url() }).parse(process.env);

const db = createDb(env.DATABASE_URL);
await migrate(db, { migrationsFolder: `${import.meta.dirname}/../migrations` });
await db.$client.end();
