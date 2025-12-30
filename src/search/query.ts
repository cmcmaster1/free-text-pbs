import { pool } from "../db/pool.js";
import { buildSnippet } from "./highlight.js";
import { searchElasticsearch } from "./elasticsearch.js";

const ABBREVIATIONS: Record<string, string> = {
  ra: "rheumatoid arthritis",
  psa: "psoriatic arthritis",
  as: "ankylosing spondylitis",
  gca: "giant cell arteritis",
  jia: "juvenile idiopathic arthritis",
  sle: "systemic lupus erythematosus",
  toci: "tocilizumab",
  actemra: "tocilizumab",
};

const BORROWED_ABBREVIATIONS: Record<string, string> = {
  ild: "interstitial lung disease",
  copd: "chronic obstructive pulmonary disease",
  tnf: "tnf inhibitor",
  af: "atrial fibrillation",
  htn: "hypertension",
  dm: "diabetes mellitus",
  hf: "heart failure",
};

const STOPWORDS = new Set(["streamlined"]);

export interface SearchParams {
  q: string;
  schedule?: string | null;
  limit?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  pbsCode: string;
  resCode: string;
  scheduleCode: string;
  drugName: string;
  brandName?: string | null;
  formulation?: string | null;
  programCode?: string | null;
  hospitalType?: string | null;
  authorityMethod?: string | null;
  treatmentPhase?: string | null;
  streamlinedCode?: string | null;
  score: number; // BM25 score
}

export interface PbsDocRow {
  id: string;
  title: string;
  body: string;
  pbs_code: string;
  res_code: string;
  schedule_code: string;
  drug_name: string;
  brand_name?: string | null;
  formulation?: string | null;
  program_code?: string | null;
  hospital_type?: string | null;
  authority_method?: string | null;
  treatment_phase?: string | null;
  streamlined_code?: string | null;
}

export function normalizeQuery(raw: string): string {
  const normalized = raw.normalize("NFKC").trim();
  if (!normalized) return "";
  const words = normalized
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      return ABBREVIATIONS[lower] ?? BORROWED_ABBREVIATIONS[lower] ?? word;
    })
    .filter((word) => !STOPWORDS.has(word.toLowerCase()));
  return words.join(" ").toLowerCase();
}

export async function latestScheduleCode(): Promise<string | null> {
  const { rows } = await pool.query<{ schedule_code: string }>(
    `SELECT schedule_code FROM pbs_schedule ORDER BY effective_date DESC LIMIT 1`,
  );
  return rows[0]?.schedule_code ?? null;
}

export async function searchDocs(params: SearchParams): Promise<SearchResult[]> {
  const q = normalizeQuery(params.q);
  if (!q) return [];

  const schedule = params.schedule ?? (await latestScheduleCode());
  const limit = Math.min(params.limit ?? 20, 200);

  const useElasticsearch =
    process.env.SEARCH_BACKEND?.toLowerCase() === "elasticsearch" &&
    process.env.ELASTICSEARCH_URL;
  if (useElasticsearch) {
    try {
      const esResults = await searchElasticsearch({ q, schedule, limit });
      if (esResults.length > 0) return esResults;
    } catch (err) {
      console.error("Elasticsearch search failed, falling back to Postgres", err);
    }
  }

  const primary = await runWebsearch(q, schedule, limit);
  if (primary.length > 0) return primary;

  const prefixQuery = makePrefixTsQuery(q);
  if (prefixQuery) {
    const prefixResults = await runPrefixSearch(prefixQuery, q, schedule, limit);
    if (prefixResults.length > 0) return prefixResults;
  }

  return runTrigramFallback(q, schedule, limit);
}

function sanitizeToken(token: string): string {
  return token.replace(/[^a-z0-9]+/gi, "");
}

function makePrefixTsQuery(normalized: string): string | null {
  const parts = normalized
    .split(/\s+/)
    .map(sanitizeToken)
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((p) => `${p}:*`).join(" & ");
}

async function runWebsearch(
  q: string,
  schedule: string | null | undefined,
  limit: number,
): Promise<SearchResult[]> {
  const { rows } = await pool.query<
    PbsDocRow & { bm25: number; trigram: number }
  >(
    `
      WITH query AS (
        SELECT websearch_to_tsquery('english', $1) AS ts_query
      )
      SELECT
        d.id,
        d.title,
        d.body,
        d.pbs_code,
        d.res_code,
        d.schedule_code,
        d.drug_name,
        d.brand_name,
        d.formulation,
        d.program_code,
        d.hospital_type,
        d.authority_method,
        d.treatment_phase,
        d.streamlined_code,
        ts_rank_cd(d.body_tsv, query.ts_query) AS bm25,
        greatest(similarity(d.title, $1), similarity(d.body, $1)) AS trigram
      FROM pbs_doc d, query
      WHERE ($2::text IS NULL OR d.schedule_code = $2)
        AND d.body_tsv @@ query.ts_query
      ORDER BY (ts_rank_cd(d.body_tsv, query.ts_query) * 0.7 + greatest(similarity(d.title, $1), similarity(d.body, $1)) * 0.3) DESC
      LIMIT $3
    `,
    [q, schedule, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    snippet: buildSnippet(row.body, q),
    pbsCode: row.pbs_code,
    resCode: row.res_code,
    scheduleCode: row.schedule_code,
    drugName: row.drug_name,
    brandName: row.brand_name,
    formulation: row.formulation,
    programCode: row.program_code,
    hospitalType: row.hospital_type,
    authorityMethod: row.authority_method,
    treatmentPhase: row.treatment_phase,
    streamlinedCode: row.streamlined_code,
    score: row.bm25,
  }));
}

async function runPrefixSearch(
  tsQuery: string,
  rawQuery: string,
  schedule: string | null | undefined,
  limit: number,
): Promise<SearchResult[]> {
  const { rows } = await pool.query<
    PbsDocRow & { bm25: number; trigram: number }
  >(
    `
      WITH query AS (
        SELECT to_tsquery('english', $1) AS ts_query
      )
      SELECT
        d.id,
        d.title,
        d.body,
        d.pbs_code,
        d.res_code,
        d.schedule_code,
        d.drug_name,
        d.brand_name,
        d.formulation,
        d.program_code,
        d.hospital_type,
        d.authority_method,
        d.treatment_phase,
        d.streamlined_code,
        ts_rank_cd(d.body_tsv, query.ts_query) AS bm25,
        greatest(similarity(d.title, $2), similarity(d.body, $2)) AS trigram
      FROM pbs_doc d, query
      WHERE ($3::text IS NULL OR d.schedule_code = $3)
        AND d.body_tsv @@ query.ts_query
      ORDER BY (ts_rank_cd(d.body_tsv, query.ts_query) * 0.6 + greatest(similarity(d.title, $2), similarity(d.body, $2)) * 0.4) DESC
      LIMIT $4
    `,
    [tsQuery, rawQuery, schedule, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    snippet: buildSnippet(row.body, rawQuery),
    pbsCode: row.pbs_code,
    resCode: row.res_code,
    scheduleCode: row.schedule_code,
    drugName: row.drug_name,
    brandName: row.brand_name,
    formulation: row.formulation,
    programCode: row.program_code,
    hospitalType: row.hospital_type,
    authorityMethod: row.authority_method,
    treatmentPhase: row.treatment_phase,
    streamlinedCode: row.streamlined_code,
    score: row.bm25,
  }));
}

async function runTrigramFallback(
  rawQuery: string,
  schedule: string | null | undefined,
  limit: number,
): Promise<SearchResult[]> {
  const { rows } = await pool.query<PbsDocRow & { trigram: number }>(
    `
      SELECT
        d.id,
        d.title,
        d.body,
        d.pbs_code,
        d.res_code,
        d.schedule_code,
        d.drug_name,
        d.brand_name,
        d.formulation,
        d.program_code,
        d.hospital_type,
        d.authority_method,
        d.treatment_phase,
        d.streamlined_code,
        greatest(similarity(d.title, $1), similarity(d.body, $1)) AS trigram
      FROM pbs_doc d
      WHERE ($2::text IS NULL OR d.schedule_code = $2)
      ORDER BY trigram DESC
      LIMIT $3
    `,
    [rawQuery, schedule, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    snippet: buildSnippet(row.body, rawQuery),
    pbsCode: row.pbs_code,
    resCode: row.res_code,
    scheduleCode: row.schedule_code,
    drugName: row.drug_name,
    brandName: row.brand_name,
    formulation: row.formulation,
    programCode: row.program_code,
    hospitalType: row.hospital_type,
    authorityMethod: row.authority_method,
    treatmentPhase: row.treatment_phase,
    streamlinedCode: row.streamlined_code,
    score: row.trigram,
  }));
}

export async function getDocById(id: string): Promise<PbsDocRow | null> {
  const { rows } = await pool.query<PbsDocRow>(
    `
      SELECT id, title, body, pbs_code, schedule_code, drug_name, brand_name,
             formulation, program_code, hospital_type, res_code,
             authority_method, treatment_phase, streamlined_code
      FROM pbs_doc
      WHERE id = $1
    `,
    [id],
  );
  return rows[0] ?? null;
}
