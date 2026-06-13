-- pgvector must exist before any table using the vector type (faq_chunks.embedding).
-- drizzle-kit never emits CREATE EXTENSION, hence this custom migration as step 0000.
CREATE EXTENSION IF NOT EXISTS vector;
