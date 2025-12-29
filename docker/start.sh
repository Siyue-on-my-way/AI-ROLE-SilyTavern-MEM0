#!/bin/bash

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "WARNING: Please edit .env and set your OPENAI_API_KEY before running if you plan to use OpenAI features in mem0."
fi

# Create volume directories to avoid permission issues
mkdir -p volumes/sillytavern/config
mkdir -p volumes/sillytavern/data
mkdir -p volumes/sillytavern/plugins
mkdir -p volumes/sillytavern/public/user
mkdir -p volumes/postgres
mkdir -p volumes/neo4j/data

echo "Starting services..."
docker compose up -d --build

echo ""
echo "Services started!"
echo "SillyTavern: http://localhost:8000"
echo "mem0 Server: http://localhost:8001"
echo "Neo4j UI:    http://localhost:7475"
