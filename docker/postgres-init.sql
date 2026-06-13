-- Runs once on first container start (empty data volume).
-- Session starts connected to POSTGRES_DB = chatbot.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE DATABASE chatbot_test;
\connect chatbot_test
CREATE EXTENSION IF NOT EXISTS vector;
