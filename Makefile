.PHONY: help

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

deps-up: ## bring up all dependencies service and let them run in background
	COMPOSE_FILE=docker-compose-deps.yml dc up -d


###############################################################################
########################## Interactive Utils  #################################
###############################################################################
psql: ## open interactive psql shell
	docker exec -it --user postgres oak-subql_postgres_1 psql

