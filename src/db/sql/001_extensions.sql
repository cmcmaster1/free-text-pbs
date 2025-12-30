-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
-- vector extension is optional and may not be available on all managed Postgres instances.
-- CREATE EXTENSION IF NOT EXISTS vector;
