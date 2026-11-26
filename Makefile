.PHONY: up down logs e2e chaos

up:
	docker compose up --wait

down:
	docker compose down

logs:
	docker compose logs -f

e2e:
	docker compose --profile e2e run --rm e2e

# Tue le coordinateur d'une partie en pleine question et vérifie qu'elle va jusqu'au podium (pile démarrée par make up).
chaos:
	pnpm -F @quorum/realtime exec vitest run --config chaos/vitest.config.ts
