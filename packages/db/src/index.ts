import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

export * from "./schema.ts";

export function createDb(url: string) {
  return drizzle({ client: new Pool({ connectionString: url }), schema, casing: "snake_case" });
}
