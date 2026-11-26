import { z } from "zod";

// Application rendue côté client : tous les appels à l'API partent du navigateur, à travers Caddy, avec le cookie de session.
export const ssr = false;

z.config(z.locales.fr());
