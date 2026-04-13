# Makefile for VitalAgent Project
# Usage: make <command>

.PHONY: help install run-backend run-frontend ingest reset-ingest setup test clean kill-backend kill-frontend all

# Colors for output
GREEN  := \033[0;32m
YELLOW := \033[1;33m
RED    := \033[0;31m
NC     := \033[0m # No Color

# Default target
help:
	@echo "$(GREEN)VitalAgent - Makefile Commands$(NC)"
	@echo ""
	@echo "$(YELLOW)Setup & Installation:$(NC)"
	@echo "  make install      - Install Python dependencies"
	@echo "  make setup        - Full setup (install + check config)"
	@echo ""
	@echo "$(YELLOW)Database & Ingestion:$(NC)"
	@echo "  make ingest       - Run ingestion pipeline (first time)"
	@echo "  make reset-ingest - Reset and re-ingest all data"
	@echo ""
	@echo "$(YELLOW)Running Services:$(NC)"
	@echo "  make run-backend  - Start FastAPI backend (port 8000)"
	@echo "  make run-frontend - Start frontend server (port 3000)"
	@echo "  make all          - Start both backend and frontend"
	@echo ""
	@echo "$(YELLOW)Stopping Services:$(NC)"
	@echo "  make kill-backend - Stop backend server"
	@echo "  make kill-frontend- Stop frontend server"
	@echo ""
	@echo "$(YELLOW)Testing & Maintenance:$(NC)"
	@echo "  make test         - Run system tests"
	@echo "  make clean        - Clean cache and temporary files"
	@echo "  make status       - Check service status"
	@echo ""

# ============================================================
# Setup & Installation
# ============================================================

install:
	@echo "$(GREEN)Installing Python dependencies...$(NC)"
	@cd backend && pip install -r ../requirements.txt || pip install -r requirements.txt
	@echo "$(GREEN)Installing frontend dependencies...$(NC)"
	@cd frontend && npm install
	@echo "$(GREEN)Installation complete!$(NC)"

setup: install
	@echo "$(GREEN)Checking environment...$(NC)"
	@test -f .env || (echo "$(RED).env file not found! Copy .env.example to .env$(NC)" && exit 1)
	@echo "$(GREEN)Testing system...$(NC)"
	@cd scripts && python test_system.py
	@echo "$(GREEN)Setup complete! Run 'make ingest' to load data.$(NC)"

# ============================================================
# Database & Ingestion
# ============================================================

ingest:
	@echo "$(GREEN)Running ingestion pipeline...$(NC)"
	@cd scripts && python ingest.py
	@echo "$(GREEN)Ingestion complete!$(NC)"

reset-ingest:
	@echo "$(YELLOW)Resetting and re-ingesting data...$(NC)"
	@cd scripts && python ingest.py --reset
	@echo "$(GREEN)Reset and ingestion complete!$(NC)"

# ============================================================
# Running Services
# ============================================================

run-backend:
	@echo "$(GREEN)Starting FastAPI backend on http://localhost:8000...$(NC)"
	@cd backend && python main.py

run-frontend:
	@echo "$(GREEN)Starting frontend server on http://localhost:3000...$(NC)"
	@echo "$(YELLOW)Make sure to open http://localhost:3000/frontend/commercial.html or index.html$(NC)"
	@cd frontend && npx serve . --config serve.json -l 3000

# Run both in background (for development)
all:
	@echo "$(GREEN)Starting both backend and frontend...$(NC)"
	@make -j2 run-backend-detached run-frontend-detached

run-backend-detached:
	@echo "$(GREEN)Starting backend in background...$(NC)"
	@cd backend && nohup python main.py > ../logs/backend.log 2>&1 &
	@echo "$(GREEN)Backend started (PID: $$!) - Logs: logs/backend.log$(NC)"

run-frontend-detached:
	@mkdir -p logs
	@echo "$(GREEN)Starting frontend in background...$(NC)"
	@cd frontend && nohup npx serve . --config serve.json -l 3000 > ../logs/frontend.log 2>&1 &
	@echo "$(GREEN)Frontend started (PID: $$!) - Logs: logs/frontend.log$(NC)"
	@echo "$(YELLOW)Open: http://localhost:3000/frontend/commercial.html$(NC)"

# ============================================================
# Stopping Services
# ============================================================

kill-backend:
	@echo "$(YELLOW)Stopping backend server...$(NC)"
	@-pkill -f "python backend/main.py" 2>/dev/null || true
	@-lsof -ti:8000 | xargs kill -9 2>/dev/null || true
	@echo "$(GREEN)Backend stopped$(NC)"

kill-frontend:
	@echo "$(YELLOW)Stopping frontend server...$(NC)"
	@-pkill -f "serve" 2>/dev/null || true
	@-lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	@echo "$(GREEN)Frontend stopped$(NC)"

kill: kill-backend kill-frontend
	@echo "$(GREEN)All services stopped$(NC)"

# ============================================================
# Testing
# ============================================================

test:
	@echo "$(GREEN)Running system tests...$(NC)"
	@cd scripts && python test_system.py

test-token:
	@echo "$(GREEN)Testing Token Factory API...$(NC)"
	@cd scripts && python test_token_factory.py

# ============================================================
# Maintenance
# ============================================================

clean:
	@echo "$(YELLOW)Cleaning cache and temporary files...$(NC)"
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@find . -type f -name "*.pyo" -delete 2>/dev/null || true
	@find . -type f -name ".DS_Store" -delete 2>/dev/null || true
	@rm -rf logs/ 2>/dev/null || true
	@echo "$(GREEN)Clean complete!$(NC)"

clean-all: clean
	@echo "$(YELLOW)Removing virtual environment and node_modules...$(NC)"
	@-rm -rf venv/ 2>/dev/null || true
	@-rm -rf frontend/node_modules/ 2>/dev/null || true
	@-rm -rf chroma_db/ 2>/dev/null || true
	@echo "$(GREEN)Full clean complete!$(NC)"

status:
	@echo "$(YELLOW)Service Status:$(NC)"
	@echo -n "  Backend (port 8000): "
	@lsof -ti:8000 > /dev/null 2>&1 && echo "$(GREEN)Running$(NC)" || echo "$(RED)Stopped$(NC)"
	@echo -n "  Frontend (port 3000): "
	@lsof -ti:3000 > /dev/null 2>&1 && echo "$(GREEN)Running$(NC)" || echo "$(RED)Stopped$(NC)"
	@echo -n "  Ollama: "
	@curl -s http://localhost:11434/api/tags > /dev/null 2>&1 && echo "$(GREEN)Running$(NC)" || echo "$(RED)Stopped$(NC)"
	@echo -n "  MySQL: "
	@mysqladmin ping -h localhost -u root --silent 2>/dev/null && echo "$(GREEN)Running$(NC)" || echo "$(RED)Stopped$(NC)"

# ============================================================
# Quick Commands
# ============================================================

# Quick start with both services (requires manual stop with Ctrl+C)
quick: 
	@echo "$(GREEN)Quick start - Running both services...$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to stop both$(NC)"
	@(trap 'kill 0' SIGINT; \
		cd backend && python main.py & \
		cd frontend && npx serve . --config serve.json -l 3000 & \
		wait)

# Development mode with auto-reload
dev-backend:
	@echo "$(GREEN)Starting backend with auto-reload...$(NC)"
	@cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Windows specific (use make win-*)
win-help:
	@echo "$(GREEN)Windows Commands (use in Git Bash or WSL):$(NC)"
	@echo "  make win-backend  - Start backend on Windows"
	@echo "  make win-frontend - Start frontend on Windows"
	@echo "  make win-ingest   - Run ingestion on Windows"

win-backend:
	@echo "$(GREEN)Starting backend on Windows...$(NC)"
	@cd backend && python main.py

win-frontend:
	@echo "$(GREEN)Starting frontend on Windows...$(NC)"
	@cd frontend && npx serve . --config serve.json

win-ingest:
	@echo "$(GREEN)Running ingestion on Windows...$(NC)"
	@cd scripts && python ingest.py