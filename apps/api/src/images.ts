import { ImageKey, ImageType, MAX_IMAGE_BYTES, UploadedImage } from "@quorum/protocol";
import { images } from "@quorum/db";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "./app.ts";

// Envoi réservé aux animateurs. Le corps de la requête est le fichier lui-même : pas de multipart, donc pas de dépendance.
export function imageUploadRoutes(app: FastifyInstance, { db, storage }: Deps): void {
  app.addContentTypeParser(ImageType.options, { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES }, (_request, body, done) => {
    done(null, body);
  });
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.post(
    "/api/images",
    { schema: { headers: z.object({ "content-type": ImageType }), body: z.instanceof(Buffer), response: { 201: UploadedImage } } },
    async (request, reply) => {
      const type = request.headers["content-type"];
      const key = `${crypto.randomUUID()}.${type.slice("image/".length)}`;
      // Inscrite avant l'envoi : une image orpheline est toujours connue du worker, qui la supprimera (ADR 0013).
      await db.insert(images).values({ key });
      const response = await storage.client.fetch(`${storage.bucketUrl}/${key}`, {
        method: "PUT",
        body: request.body,
        headers: { "content-type": type },
      });
      if (!response.ok) throw new Error(`Le stockage a refusé l'image : ${String(response.status)}`);
      return reply.code(201).send({ url: `/api/images/${key}` });
    },
  );
}

// Lecture publique : le nom d'une image est imprévisible, et l'écran projeté n'a pas de session.
export function imageRoutes(app: FastifyInstance, { storage }: Deps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get("/api/images/:key", { schema: { params: z.object({ key: ImageKey }) } }, async (request, reply) => {
    const { key } = request.params;
    const response = await storage.client.fetch(`${storage.bucketUrl}/${key}`);
    if (response.status === 404) return reply.code(404).send();
    if (!response.ok) throw new Error(`Le stockage n'a pas rendu l'image : ${String(response.status)}`);
    // Une image ne change jamais sous le même nom : le navigateur la garde en cache.
    return reply
      .header("content-type", `image/${key.slice(key.indexOf(".") + 1)}`)
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .send(response.body);
  });
}
