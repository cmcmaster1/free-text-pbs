-- Core PBS tables
CREATE TABLE IF NOT EXISTS pbs_schedule (
  schedule_code TEXT PRIMARY KEY,
  effective_date DATE NOT NULL,
  source_url TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pbs_doc (
  id UUID PRIMARY KEY,
  schedule_code TEXT NOT NULL REFERENCES pbs_schedule(schedule_code),
  pbs_code TEXT NOT NULL,
  res_code TEXT NOT NULL,
  drug_name TEXT NOT NULL,
  brand_name TEXT,
  formulation TEXT,
  program_code TEXT,
  hospital_type TEXT,
  authority_method TEXT,
  treatment_phase TEXT,
  streamlined_code TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  body_tsv TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', unaccent(coalesce(title, '') || ' ' || coalesce(body, '')))
  ) STORED,
  embedding VECTOR(1536),
  source_json JSONB NOT NULL,
  UNIQUE(schedule_code, pbs_code, res_code, brand_name)
);
