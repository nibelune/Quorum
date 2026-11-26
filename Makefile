.PHONY: up down logs

up:
	docker compose up --wait

down:
	docker compose down

logs:
	docker compose logs -f
