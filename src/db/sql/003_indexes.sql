CREATE INDEX IF NOT EXISTS idx_pbs_doc_body_tsv ON pbs_doc USING GIN (body_tsv);
CREATE INDEX IF NOT EXISTS idx_pbs_doc_body_trgm ON pbs_doc USING GIN (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pbs_doc_title_trgm ON pbs_doc USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pbs_doc_schedule_code ON pbs_doc (schedule_code);
CREATE INDEX IF NOT EXISTS idx_pbs_doc_embedding ON pbs_doc USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100) WHERE embedding IS NOT NULL;
