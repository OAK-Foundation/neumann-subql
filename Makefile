.PHONY: help

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

up: ## bring up everything in the right order
	docker compose -f docker-compose-deps.yml -f docker-compose-ss.yml -f docker-compose.yml -f docker-compose-app.yml build
	docker compose -f docker-compose-deps.yml -f docker-compose-ss.yml -f docker-compose.yml -f docker-compose-app.yml up -d

down: ## bring down everything in the right order
	docker compose -f docker-compose-deps.yml -f docker-compose-ss.yml -f docker-compose.yml -f docker-compose-app.yml down

build: ## build docker image
	docker compose -f docker-compose-deps.yml -f docker-compose-ss.yml -f docker-compose.yml -f docker-compose-app.yml build

###############################################################################
#################################  Local Dev  #################################
###############################################################################

deps-up: ## bring up all dependencies service and let them run in background
	COMPOSE_FILE=docker-compose-deps.yml docker compose build
	COMPOSE_FILE=docker-compose-deps.yml docker compose up -d

deps-down: ## bring down all dependencies service, useful when we want to nuke their data dir
	COMPOSE_FILE=docker-compose-deps.yml docker compose down


###############################################################################
########################## Interactive Utils  #################################
###############################################################################
psql: ## open interactive psql shell
	COMPOSE_FILE=docker-compose-deps.yml docker compose exec postgres psql -h 127.0.0.1 -U postgres
