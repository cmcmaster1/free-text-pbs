import { pool } from "../db/pool.js";
import { buildSnippet } from "./highlight.js";
import { blendedScore } from "./rank.js";

const ABBREVIATIONS: Record<string, string> = {
  ra: "rheumatoid arthritis",
  psa: "psoriatic arthritis",
  as: "ankylosing spondylitis",
  gca: "giant cell arteritis",
  jia: "juvenile idiopathic arthritis",
  sle: "systemic lupus erythematosus",
  toci: "tocilizumab",
};

export interface SearchParams {
  q: string;
  schedule?: string | null;
  limit?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  scheduleCode: string;
  drugName: string;
  brandName?: string | null;
  authorityMethod?: string | null;
  treatmentPhase?: string | null;
  streamlinedCode?: string | null;
  score: number;
}

export interface PbsDocRow {
  id: string;
  title: string;
  body: string;
  schedule_code: string;
  drug_name: string;
  brand_name?: string | null;
  authority_method?: string | null;
  treatment_phase?: string | null;
  streamlined_code?: string | null;
}

export function normalizeQuery(raw: string): string {
  const normalized = raw.normalize("NFKC").trim();
  if (!normalized) return "";
  const words = normalized.split(/\s+/).map((word) => {
    const lower = word.toLowerCase();
    return ABBREVIATIONS[lower] ?? word;
  });
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

  const { rows } = await pool.query<
    PbsDocRow & { fts_rank: number; trigram: number }
  >(
    `
      WITH query AS (
        SELECT websearch_to_tsquery('english', $1) AS ts_query
      )
      SELECT
        d.id,
        d.title,
        d.body,
        d.schedule_code,
        d.drug_name,
        d.brand_name,
        d.authority_method,
        d.treatment_phase,
        d.streamlined_code,
        ts_rank(d.body_tsv, query.ts_query) AS fts_rank,
        greatest(similarity(d.title, $1), similarity(d.body, $1)) AS trigram
      FROM pbs_doc d, query
      WHERE ($2::text IS NULL OR d.schedule_code = $2)
        AND (d.body_tsv @@ query.ts_query OR similarity(d.title, $1) > 0.1)
      ORDER BY (ts_rank(d.body_tsv, query.ts_query) * 0.7 + greatest(similarity(d.title, $1), similarity(d.body, $1)) * 0.3) DESC
      LIMIT $3
    `,
    [q, schedule, limit],
  );

  return rows.map((row) => {
    const lexical = row.fts_rank * 0.7 + row.trigram * 0.3;
    return {
      id: row.id,
      title: row.title,
      snippet: buildSnippet(row.body, q),
      scheduleCode: row.schedule_code,
      drugName: row.drug_name,
      brandName: row.brand_name,
      authorityMethod: row.authority_method,
      treatmentPhase: row.treatment_phase,
      streamlinedCode: row.streamlined_code,
      score: blendedScore({ lexical }),
    };
  });
}

export async function getDocById(id: string): Promise<PbsDocRow | null> {
  const { rows } = await pool.query<PbsDocRow>(
    `
      SELECT id, title, body, schedule_code, drug_name, brand_name,
             authority_method, treatment_phase, streamlined_code
      FROM pbs_doc
      WHERE id = $1
    `,
    [id],
  );
  return rows[0] ?? null;
}
