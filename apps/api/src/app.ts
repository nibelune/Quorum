import type { Db } from "@quorum/db";
import { fromNodeHeaders } from "better-auth/node";
import Fastify, { type FastifyServerOptions } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Redis } from "ioredis";
import type { Auth } from "./auth.ts";
import { gameRoutes } from "./games.ts";
import { quizRoutes } from "./quizzes.ts";

export interface Deps {
  db: Db;
  redis: Redis;
  auth: Auth;
  sessionSecret: string;
}

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

export function buildApp(deps: Deps, logger: FastifyServerOptions["logger"] = false) {
  const app = Fastify({ logger });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.get("/api/health", { logLevel: "silent" }, () => ({ ok: true }));

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const response = await deps.auth.handler(
        new Request(new URL(request.url, `http://${request.host}`), {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          body: request.body ? JSON.stringify(request.body) : null,
        }),
      );
      reply.status(response.status);
      for (const [key, value] of response.headers) reply.header(key, value);
      return reply.send(response.body ? await response.text() : null);
    },
  });

  // Toutes les routes enregistrées ici exigent une session d'animateur.
  void app.register((animator, _options, done) => {
    animator.decorateRequest("userId", "");
    animator.addHook("onRequest", async (request, reply) => {
      const session = await deps.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      if (!session) return reply.code(401).send();
      request.userId = session.user.id;
    });
    quizRoutes(animator, deps);
    gameRoutes(animator, deps);
    done();
  });

  return app;
}
