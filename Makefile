PYTHON ?= python3

.DEFAULT_GOAL := help
.PHONY: help venv run demo test lint typecheck js-check ci up down logs

help: ## Показать команды
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "%-12s %s\n", $$1, $$2}'

venv: ## Создать .venv и поставить зависимости
	$(PYTHON) -m venv .venv && .venv/bin/pip install -r requirements/dev.txt

run: ## Запустить сайт на http://localhost:8000 (нужен интернет)
	.venv/bin/uvicorn app.web:app --reload --port 8000

demo: ## Запустить на вымышленных данных, без интернета
	DEMO_MODE=true DB_PATH=data/demo.db .venv/bin/uvicorn app.web:app --reload --port 8000

test: ## Тесты
	.venv/bin/pytest

lint: ## Ruff
	.venv/bin/ruff check . && .venv/bin/ruff format --check .

typecheck: ## Mypy
	.venv/bin/mypy

js-check: ## Проверка синтаксиса JS-модулей
	@for f in $$(find app/web/static/js -name '*.js'); do node --check $$f || exit 1; done; echo "JS ok"

ci: lint typecheck js-check test ## Всё сразу

up: ## docker compose up -d --build
	docker compose up -d --build

down: ## docker compose down
	docker compose down

logs: ## Логи контейнера
	docker compose logs -f
