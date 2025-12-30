# PBS Free-Text Search — Maintenance Notes

## Stack Overview
- Runtime: Node.js + TypeScript (`tsconfig` targets NodeNext).
- API: Express (see `src/api/server.ts` and route files).
- DB: Postgres with `pg_trgm`, `vector` (pgvector), `unaccent` optional; schema in `src/db/sql/00*.sql`.
- Search: Postgres FTS (`tsvector` on `body_tsv`) + trigram similarity by default; optional Elasticsearch backend (`SEARCH_BACKEND=elasticsearch`) using `ELASTICSEARCH_URL`/`ELASTICSEARCH_API_KEY`.
- Ingestion: downloads PBS API CSV ZIP for a month, parses, composes docs, bulk upserts (`src/ingest/*`).

## Local Development
- Install: `npm install`
- Typecheck: `npm run typecheck`
- Migrations (requires `DATABASE_URL`): `npm run migrate`
- Ingest latest schedule: `npm run ingest:latest`
- Ingest specific month: `npm run ingest:month -- YYYY-MM-DD`
- Eval harness: `npm run eval` (uses `src/eval/queries.yaml`)
- Dev server: `npm run dev` (runs API on `PORT`, defaults to 3000)

### Environment Variables
- `DATABASE_URL` (Postgres connection string)
- `PGSSLMODE` (`disable` for Railway internal, `require` for public proxy)
- `PBS_DOWNLOAD_BASE` (default `https://www.pbs.gov.au/downloads`)
- `PBS_LOOKBACK_MONTHS` (default 6)
- `ADMIN_INGEST_TOKEN` (required for POST `/api/admin/ingest`)
- `PORT` (API server)
- Search backend:
  - `SEARCH_BACKEND=elasticsearch` to route `/api/search` to ES
  - `ELASTICSEARCH_URL` (e.g. `http://localhost:9200`)
  - `ELASTICSEARCH_API_KEY` (optional)
  - `ELASTICSEARCH_INDEX` (optional, default `pbs-docs`)
- Embeddings (not wired by default): `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_MODEL`, `EMBEDDINGS_API_KEY`

### Data & Generated Files
- Ingestion downloads ZIPs and may write helper artifacts; keep them out of git (see `.gitignore`).
- If you generate abbreviation data or other helpers, place in `data/` (ignored).

## Deployment to Railway
1) Create/ensure Postgres service with `pg_trgm` and `vector` extensions. Note internal vs public host:
   - Internal (preferred for app-to-DB): `postgres://...@<service>.railway.internal:5432/...`
   - Public proxy (if needed locally): `postgres://...@<proxy>.railway.net:<port>/...`
2) Set env vars on the app service:
   - `DATABASE_URL`, `PGSSLMODE=disable` (for internal host) or `PGSSLMODE=require` (for proxy)
   - `PBS_DOWNLOAD_BASE`, `PBS_LOOKBACK_MONTHS`, `ADMIN_INGEST_TOKEN`, `PORT`
3) Deploy: `railway up` (build uses `npm ci` -> `npm run build` -> `npm run start`).
4) Run migrations (once per DB): `railway run npm run migrate` (or locally with the same `DATABASE_URL`).
5) Trigger ingestion:
   - Local: `npm run ingest:latest` with env pointing to Railway DB.
   - Remote: POST `/api/admin/ingest` with header `x-admin-token: <ADMIN_INGEST_TOKEN>`.
6) Health checks:
   - `/api/health` (API up)
   - `/api/debug/db` (DB connectivity)

## Improving Search Quality
- Normalize/query tweaks live in `src/search/query.ts` and `src/search/highlight.ts`.
- Rankings currently BM25 + trigram; embeddings are stubbed. Add embeddings in `src/ingest/embed.ts` and incorporate semantic rerank when ready.
- Ingestion quality lives in `src/ingest/buildDocs.ts`; refine joins and body composition as PBS CSV schema evolves.
- Add new eval queries to `src/eval/queries.yaml` whenever you spot misses; keep `npm run eval` green before deploys.

## PBS Ingestion Notes
- URL resolution: `resolveScheduleUrl` checks monthly PBS downloads; keep patterns updated if the site changes.
- Do not delete prior schedules; each schedule is keyed by `schedule_code` (YYYY-MM).
- `pbs_doc` uniqueness: `(schedule_code, pbs_code, res_code, brand_name)`; adjust if granularity changes.

## Troubleshooting on Railway
- Database timeouts: verify `DATABASE_URL` host/port and `PGSSLMODE`. Use the internal host for app traffic.
- Extensions missing: rerun `npm run migrate` to create `pg_trgm`/`vector` once the service supports them.
- Ingest failures: check download URL resolution and CSV schema changes; log errors in `src/ingest/*`.
- 502 from API: check deploy logs and `/api/debug/db`; ensure DB reachable from the app service.
