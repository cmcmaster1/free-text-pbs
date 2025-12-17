# AGENTS.md — PBS CSV Search (Postgres + Railway)

This repo builds a clinician-friendly free-text search over monthly PBS CSV ZIPs. Core goals:
- Free-text search that tolerates typos/abbrev and "near-synonyms" without maintaining a synonym database.
- Postgres-backed (FTS + trigram + vector rerank) with a clean ingestion pipeline.
- Deterministic, reproducible monthly indexing with traceability to source rows.

---

## 0) Definitions

**Schedule**: the monthly PBS CSV zip (effective on the 1st of the month).
**Document (pbs_doc)**: the searchable unit representing a composed PBS restriction entry, typically keyed by `(schedule_code, pbs_code, res_code)`.

We store a "composed" view (title/body + metadata + trace JSON), not raw CSV rows as the primary query target.

---

## 1) Tech choices (locked-in)

- Runtime: Node.js + TypeScript
- DB: Postgres (Railway)
- Search:
  - Lexical: Postgres FTS (`tsvector`) + trigram (`pg_trgm`)
  - Semantic: pgvector (`vector`) for reranking
- Ingestion: download PBS zip → parse CSVs → build relationship maps → compose documents → bulk upsert → compute embeddings

---

## 2) Repository layout (suggested)

```
/src
  /ingest
    download.ts
    extract.ts
    parse.ts
    buildDocs.ts
    upsert.ts
    embed.ts
    run.ts
  /db
    pool.ts
    migrate.ts
    sql/
      001_extensions.sql
      002_schema.sql
      003_indexes.sql
  /api
    server.ts
    routes.search.ts
    routes.doc.ts
    routes.ingest.ts
  /search
    query.ts
    rank.ts
    highlight.ts
  /eval
    queries.yaml
    runEval.ts
  /scripts
    ingest_latest.ts
    ingest_month.ts
    backfill.ts
```

---

## 3) Environment variables

Required:
- `DATABASE_URL` (Railway Postgres connection string)

For ingestion:
- `PBS_DOWNLOAD_BASE=https://www.pbs.gov.au/downloads`
- `PBS_LOOKBACK_MONTHS=6`

For embeddings (choose one path):
- External embeddings API:
  - `EMBEDDINGS_PROVIDER=openai|...`
  - `EMBEDDINGS_MODEL=...`
  - `EMBEDDINGS_API_KEY=...`
- Local embeddings (optional later):
  - `EMBEDDINGS_PROVIDER=local`
  - `EMBEDDINGS_MODEL_PATH=...`

Operational:
- `ADMIN_INGEST_TOKEN=...` (protect ingest endpoint)
- `PORT=...`

---

## 4) Database setup

### 4.1 Extensions

Enable:
- `pg_trgm`
- `unaccent` (optional but recommended)
- `vector` (pgvector)

### 4.2 Schema (minimum)

Tables:

**pbs_schedule**
- `schedule_code TEXT PRIMARY KEY` (e.g. `2025-12`)
- `effective_date DATE NOT NULL`
- `source_url TEXT NOT NULL`
- `ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()`

**pbs_doc**
- `id UUID PRIMARY KEY`
- `schedule_code TEXT NOT NULL REFERENCES pbs_schedule(schedule_code)`
- `pbs_code TEXT NOT NULL`
- `res_code TEXT NOT NULL`

Metadata (nullable unless specified):
- `drug_name TEXT NOT NULL`
- `brand_name TEXT`
- `formulation TEXT`
- `program_code TEXT`
- `hospital_type TEXT`          // derived ("Public"/"Private"/"Any") if possible
- `authority_method TEXT`
- `treatment_phase TEXT`
- `streamlined_code TEXT`

Search fields:
- `title TEXT NOT NULL`
- `body TEXT NOT NULL`
- `body_tsv TSVECTOR NOT NULL`  // derived from title/body using unaccent+english config
- `embedding VECTOR(<D>)`       // D matches embedding model dims; nullable until embedded

Trace:
- `source_json JSONB NOT NULL`  // IDs, raw fragments, row keys used to compose doc

Uniqueness:
- `UNIQUE(schedule_code, pbs_code, res_code, brand_name)` (brand_name optional; decide granularity)

### 4.3 Indexes (phase-based)

MVP lexical:
- `GIN(body_tsv)`
- `GIN(body gin_trgm_ops)`
- `BTREE(schedule_code)`

Hybrid:
- Vector index on `embedding` (HNSW preferred if available; else IVFFLAT)
- Keep `schedule_code` predicate fast: composite indexes if needed.

---

## 5) Ingestion pipeline

### 5.1 Resolve schedule zip URL

Given a target date (default now), compute:
- `year = UTC year`
- `month = UTC month`
- schedule candidate date = first of month UTC

Try the most recent month first; if not found, look back `PBS_LOOKBACK_MONTHS`.

Check existence with `HEAD` requests.

NOTE: PBS naming may vary; keep `getDownloadUrl` configurable and maintainable.

### 5.2 Download + extract

- Download zip as Buffer
- Extract relevant CSVs (don't assume case; match by lowercased endsWith path)
- Parse CSV with PapaParse:
  - `header: true`
  - `skipEmptyLines: true`
  - Keep all fields as strings; normalize later

### 5.3 Normalize helpers

Implement tiny, deterministic helpers:
- `toNull` trims, converts `''`/`'null'` → null
- `toNumber` parse int safe
- `upper` for authority/program codes
- Title-case only for display fields; keep raw too if useful

### 5.4 Build relationship maps

Build Maps/Sets to join quickly (examples; actual keys depend on PBS schema):

- `restrictionByResCode: Map<res_code, restrictionRow>`
- `resCodesByPbsCode: Map<pbs_code, Set<res_code>>`
- `prescribingTextById: Map<prescribing_text_id, prescribingTextRow>`
- `prescribingIdsByResCode: Map<res_code, Set<prescribing_text_id>>`
- `indicationByPrescribingId: Map<prescribing_text_id, indicationRow>` (or both possible columns)
- Additional optional joins:
  - item ↔ prescribing-text relationships
  - restriction ↔ restriction-text relationships
  - any table that increases `body` quality

Keep all intermediate joins "explainable"; store IDs in `source_json`.

### 5.5 Compose documents

For each item (pbs_code), for each linked restriction (res_code):
- Gather:
  - Item metadata: drug_name, brand_name(s), formulation, program_code…
  - Restriction metadata: authority_method, treatment_phase, streamlined code…
  - Text fragments: condition/indication, criteria, notes, admin, etc.

Build:
- `title`: stable + short (drug + key condition/indication + phase if present)
- `body`: concatenated, plain text, deterministic ordering.
  - Keep it human-readable; it will be displayed.
  - Strip HTML tags where appropriate; keep meaningful punctuation.

Build `source_json`:
- all contributing row IDs/codes
- fragments list (id + excerpt + table name)
- any fallbacks used

### 5.6 Upsert to Postgres (transaction)

One transaction per schedule ingestion:
1) insert into `pbs_schedule` (upsert)
2) bulk upsert `pbs_doc` rows for that schedule
3) build `body_tsv` either:
   - as a generated column (preferred), or
   - via SQL update using `to_tsvector(...)`

IMPORTANT: do not delete prior schedules unless explicitly asked. Default: keep history.

### 5.7 Embeddings (ingestion-time)

After upsert, embed docs where `embedding IS NULL` for that schedule.
- Embed input should be: `title + "\n\n" + body` (or a curated shorter variant if token limits).
- Batch requests; store results.

If embedding provider is unavailable, ingestion should still succeed; semantic rerank is optional.

---

## 6) Search implementation

### 6.1 Query normalization (minimal)

We are **not** maintaining a synonym DB. Do only:
- lowercase
- trim
- unicode normalization
- optional: a tiny abbrev expansion list for extremely common shorthands (RA, PsA, AS, GCA, JIA, SLE, "toci")
  - keep this list short and clinically grounded

### 6.2 Two-stage retrieval (recommended)

**Stage A: lexical candidates**
- Use both:
  - FTS rank on `body_tsv`
  - trigram similarity on `title` and/or `body`
- Return top N candidate IDs (N=100 default), filtered by schedule_code.

**Stage B: semantic rerank**
If embeddings are available:
- embed query once
- rerank candidates by cosine/inner product similarity
- optionally combine scores:
  - `final = 0.6 * semantic + 0.4 * lexical` (tune later)

Return top K (K=20 default).

### 6.3 Snippets + highlighting

For each result:
- return small snippet (200–400 chars) from body around best-matching region
- optionally include highlights (terms from query)

Keep highlight logic deterministic and safe (no regex DoS).

### 6.4 Facets (later)

Once results are good:
- expose facets: drug_name, authority_method, treatment_phase, hospital_type, program_code
- implement as additional filters on search endpoint

---

## 7) API endpoints

- `GET /api/health` → ok
- `GET /api/search?q=...&schedule=2025-12&limit=20`
- `GET /api/doc/:id`
- `POST /api/admin/ingest` (protected by `ADMIN_INGEST_TOKEN`)
  - body: `{ targetDate?: "YYYY-MM-DD", lookbackMonths?: number }`

Security:
- Never expose raw admin tokens in logs.
- Rate-limit search endpoint (simple IP-based or reverse-proxy).

---

## 8) Railway deployment

- Run migrations on deploy (or a one-off job step).
- Use a separate "ingest" job:
  - either manual trigger (admin endpoint)
  - or scheduled via Railway cron (later)

Performance:
- Batch inserts and embedding calls.
- Keep response times low by limiting Stage A candidate set and using indexes.

---

## 9) Evaluation harness (do this early)

Create `/src/eval/queries.yaml` with entries like:

```yaml
- q: "rheumatoid arthritis tocilizumab initial"
  expect:
    drug: "Tocilizumab"
    contains: ["Rheumatoid", "Initial"]
- q: "gca actemra streamlined"
  expect:
    contains: ["Giant", "cell", "arteritis"]
- q: "psa tnf continuing"
  expect:
    contains: ["Psoriatic", "continuing"]
```

`runEval.ts`:
- runs search for each query
- checks top-5 contains expected fields/phrases
- prints summary metrics (top1/top5 hit rate)

Treat this as a regression test. Add new queries whenever you notice a miss.

---

## 10) Milestones

**M0: Skeleton**
- DB migrations + minimal API server
- pbs_doc schema and indexes (lexical only)
- Ingestion that produces documents and stores them
- /search returns results

**M1: Robust lexical**
- FTS + trigram blended scoring
- snippets + highlighting
- schedule selector (latest by default)

**M2: Hybrid**
- pgvector column + embeddings during ingestion
- two-stage search (lexical candidates → semantic rerank)

**M3: Quality + UX**
- facets/filters
- "show source" (render source_json fragments)
- evaluation harness + CI

**M4: Optional fine-tuning**
- only if eval shows persistent failure on PBS-specific phrasing/abbrev
- generate synthetic query-doc pairs from structured fields (no synonym DB)

---

## 11) Non-goals (for now)

- Maintaining a large synonym database.
- A separate dedicated search engine cluster.
- Real-time ingestion on every request.
- Writing a full PBS schema mirror into normalized relational tables (unless needed later).

---

## 12) Implementation notes / pitfalls

- PBS file naming may change; keep URL construction and resolution flexible.
- CSV schemas can evolve; ingestion should fail loudly with good diagnostics when required columns are missing.
- Store enough in source_json to reproduce a doc exactly.
- Keep composed text deterministic: same inputs → same body.
- Avoid embedding huge bodies; if needed, truncate or embed a curated "core text" subset.

---

## 13) "Definition of done" for MVP

- A user can type: `rheumatoid arthritis tocilizumab initial`
- Top results include the correct restriction entry (drug + indication + phase)
- Works for minor typos and shorthand (at least common ones)
- Monthly ingestion is repeatable and doesn't break old schedules
- Debug view can show why a result matched (title/body + fragments)
