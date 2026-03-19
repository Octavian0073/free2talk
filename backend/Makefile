ENV_FILE := ../.env

# Load .env and export all variables into the make environment.
# set -a auto-exports every variable defined after it.
# This means 'make run' works without any manual export step.
ifneq (,$(wildcard $(ENV_FILE)))
	include $(ENV_FILE)
	export
endif

.PHONY: run build clean tidy

## run: start the development server (loads .env automatically)
run:
	@go run ./cmd/server

## build: compile to bin/free2talk
build:
	@mkdir -p bin
	@go build -o bin/free2talk ./cmd/server
	@echo "built: bin/free2talk"

## tidy: sync go.mod and go.sum
tidy:
	@go mod tidy

## clean: remove build artifacts
clean:
	@rm -rf bin/
