import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema.ts";

export * from "./schema.ts";

export function createDb(url: string) {
  return drizzle({ client: new Pool({ connectionString: url }), schema, casing: "snake_case" });
}
export type Db = ReturnType<typeof createDb>;

export async function applyMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: `${import.meta.dirname}/../migrations` });
}
