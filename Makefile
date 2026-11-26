.PHONY: up down logs e2e

up:
	docker compose up --wait

down:
	docker compose down

logs:
	docker compose logs -f

e2e:
	docker compose --profile e2e run --rm e2e
