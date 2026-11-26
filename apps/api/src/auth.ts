import type { Db } from "@quorum/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export function createAuth(db: Db, config: { publicOrigin: string; secret: string }) {
  return betterAuth({
    baseURL: config.publicOrigin,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: "pg", usePlural: true }),
    emailAndPassword: { enabled: true },
    advanced: {
      database: { generateId: "uuid" },
      // Comme realtime, l'IP du client (limite de débit en production) vient de X-Real-IP, toujours posé par Caddy.
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;
