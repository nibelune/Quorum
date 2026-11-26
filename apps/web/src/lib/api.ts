import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import type { z } from "zod";

// Appel typé à l'API : la réponse est validée par le schéma du protocole. Sans session, retour à la connexion.
export async function api<T extends z.ZodType>(
  schema: T,
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {},
): Promise<z.infer<T>> {
  // Un fichier (une image) part tel quel, avec son type ; le reste en JSON.
  const file = body instanceof Blob ? body : null;
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": file ? file.type : "application/json" },
    body: body === undefined ? null : (file ?? JSON.stringify(body)),
  });
  if (response.status === 401) {
    await goto(resolve("/login"));
    throw new Error("Session expirée");
  }
  if (!response.ok) throw new Error(`L'API a répondu ${String(response.status)} à ${method} ${path}`);
  return schema.parse(response.status === 204 ? null : await response.json());
}
