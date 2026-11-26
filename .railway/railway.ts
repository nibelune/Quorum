import { bucket, defineRailway, github, image, preserve, project, service, volume } from "railway/iac";

// Infrastructure de production sur Railway (ADR 0012). Appliquée à la main : `railway config plan`, puis `railway config apply`.
// Les secrets ne sont jamais ici : `preserve()` garde la valeur posée dans Railway.

// Chaque app est construite depuis son Dockerfile, à la racine du dépôt, et redéployée à chaque push sur main
// une fois la CI verte, seulement si ses sources ou celles des packages partagés ont changé.
function fromRepo(dockerfilePath: string, watchPatterns: string[]) {
  return {
    source: github("nibelune/Quorum", { branch: "main", checkSuites: true }),
    build: { builder: "DOCKERFILE" as const, dockerfilePath, watchPatterns },
  };
}

const PUBLIC_ORIGIN = "https://${{caddy.RAILWAY_PUBLIC_DOMAIN}}";
const REDIS_URL = "redis://${{redis.RAILWAY_PRIVATE_DOMAIN}}:6379";
// Railway injecte PORT et y adresse ses healthchecks : on le fixe au port d'écoute des apps.
const PORT = "3000";
// Région et taille fixées par Railway à la création : les reprendre ici évite qu'un plan tente de les réduire.
const VOLUME = { region: "europe-west4-drams3a", sizeMB: 5000 };

export default defineRailway(() => {
  const postgresData = volume("postgres-data", VOLUME);
  const postgres = service("postgres", {
    source: image("postgres:17"),
    volumeMounts: { "/var/lib/postgresql/data": postgresData },
    env: {
      POSTGRES_USER: "quorum",
      POSTGRES_DB: "quorum",
      POSTGRES_PASSWORD: preserve(),
      // Le volume contient lost+found : Postgres initialise ses données dans un sous-dossier.
      PGDATA: "/var/lib/postgresql/data/pgdata",
    },
  });

  const redisData = volume("redis-data", VOLUME);
  const redis = service("redis", {
    source: image("redis:7.4"),
    volumeMounts: { "/data": redisData },
  });

  // Images des questions (ADR 0013). Le bucket est privé : l'API est seule à y lire et écrire.
  const images = bucket("images", { region: "ams" });

  const api = service("api", {
    ...fromRepo("apps/api/Dockerfile", ["apps/api/**", "packages/**", "pnpm-lock.yaml"]),
    preDeploy: "node /app/packages/db/src/migrate.ts",
    healthcheck: "/api/health",
    env: {
      PORT,
      DATABASE_URL: "postgres://quorum:${{postgres.POSTGRES_PASSWORD}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/quorum",
      REDIS_URL,
      PUBLIC_ORIGIN,
      SESSION_SECRET: preserve(),
      BETTER_AUTH_SECRET: preserve(),
      // Adressage par chemin, comme avec le serveur S3 local du Compose.
      S3_BUCKET_URL: "${{images.ENDPOINT}}/${{images.BUCKET}}",
      S3_REGION: "${{images.REGION}}",
      S3_ACCESS_KEY_ID: "${{images.ACCESS_KEY_ID}}",
      S3_SECRET_ACCESS_KEY: "${{images.SECRET_ACCESS_KEY}}",
    },
  });

  // Arrêt progressif : SIGTERM, leases relâchés, sockets fermées en 1012, avant l'arrêt forcé.
  const realtime = service("realtime", {
    ...fromRepo("apps/realtime/Dockerfile", ["apps/realtime/**", "packages/**", "pnpm-lock.yaml"]),
    replicas: 3,
    healthcheck: "/health",
    deploy: { drainingSeconds: 10 },
    env: { PORT, REDIS_URL, PUBLIC_ORIGIN, SESSION_SECRET: api.env.SESSION_SECRET },
  });

  const web = service("web", {
    ...fromRepo("apps/web/Dockerfile", ["apps/web/**", "packages/protocol/**", "pnpm-lock.yaml"]),
    healthcheck: "/",
    env: { PORT, PUBLIC_ORIGIN },
  });

  // Seul service public : il route /api, /ws et le web sur une même origine (cookie de session).
  const caddy = service("caddy", {
    ...fromRepo("docker/caddy.Dockerfile", ["docker/**"]),
    env: {
      PORT: "8080",
      API_UPSTREAM: "${{api.RAILWAY_PRIVATE_DOMAIN}}:3000",
      WEB_UPSTREAM: "${{web.RAILWAY_PRIVATE_DOMAIN}}:3000",
      REALTIME_HOST: "${{realtime.RAILWAY_PRIVATE_DOMAIN}}",
      // Caddy n'est joignable qu'à travers le point d'entrée de Railway, qui écrase X-Real-IP à chaque requête.
      TRUSTED_PROXIES: "0.0.0.0/0 ::/0",
    },
  });

  return project("quorum", {
    resources: [postgresData, postgres, redisData, redis, images, api, realtime, web, caddy],
  });
});
