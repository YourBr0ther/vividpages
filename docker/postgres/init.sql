-- VividPages PostgreSQL Initialization Script
-- This runs automatically when the container is first created

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Grant privileges (database and user are created via env vars)
-- POSTGRES_DB and POSTGRES_USER from docker-compose.yml

-- Database is ready for Drizzle migrations
