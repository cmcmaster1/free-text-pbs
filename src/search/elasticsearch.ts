import { Client } from "@elastic/elasticsearch";

type QueryDslQueryContainer = Record<string, unknown>;

import type { ComposedDoc } from "../ingest/buildDocs.js";

interface EsSearchResult {
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
  body?: string | null;
  score: number;
}

interface SearchParamsLite {
  q: string;
  schedule?: string | null;
  limit?: number;
}

const ES_URL = process.env.ELASTICSEARCH_URL;
const ES_API_KEY = process.env.ELASTICSEARCH_API_KEY;
const ES_INDEX = process.env.ELASTICSEARCH_INDEX ?? "pbs-docs";

let client: Client | null = null;

function getClient(): Client | null {
  if (!ES_URL) return null;
  if (client) return client;
  client = new Client({
    node: ES_URL,
    ...(ES_API_KEY ? { auth: { apiKey: ES_API_KEY } } : {}),
  });
  return client;
}

async function ensureIndex(): Promise<void> {
  const es = getClient();
  if (!es) return;
  const exists = await es.indices.exists({ index: ES_INDEX });
  if (!exists) {
    await es.indices.create({
      index: ES_INDEX,
      settings: {
        analysis: {
          analyzer: {
            default: {
              type: "standard",
            },
          },
        },
      },
      mappings: {
        properties: {
          title: { type: "text" },
          body: { type: "text" },
          pbsCode: { type: "keyword" },
          resCode: { type: "keyword" },
          scheduleCode: { type: "keyword" },
          drugName: { type: "text", fields: { keyword: { type: "keyword" } } },
          brandName: { type: "text", fields: { keyword: { type: "keyword" } } },
          formulation: { type: "text" },
          programCode: { type: "keyword" },
          hospitalType: { type: "keyword" },
          authorityMethod: { type: "keyword" },
          treatmentPhase: { type: "text" },
          streamlinedCode: { type: "keyword" },
        },
      },
    });
  }
}

export async function indexDocsToElasticsearch(docs: ComposedDoc[]): Promise<void> {
  const es = getClient();
  if (!es || docs.length === 0) return;
  await ensureIndex();

  const operations = docs.flatMap((doc) => [
    { index: { _index: ES_INDEX, _id: doc.id } },
    {
      title: doc.title,
      body: doc.body,
      pbsCode: doc.pbsCode,
      resCode: doc.resCode,
      scheduleCode: doc.scheduleCode,
      drugName: doc.drugName,
      brandName: doc.brandName ?? null,
      formulation: doc.formulation ?? null,
      programCode: doc.programCode ?? null,
      hospitalType: doc.hospitalType ?? null,
      authorityMethod: doc.authorityMethod ?? null,
      treatmentPhase: doc.treatmentPhase ?? null,
      streamlinedCode: doc.streamlinedCode ?? null,
    },
  ]);

  try {
    await es.bulk(
      { operations, refresh: "wait_for" },
      {
        headers: {
          Accept: "application/vnd.elasticsearch+json; compatible-with=8",
          "Content-Type": "application/vnd.elasticsearch+json; compatible-with=8",
        },
      },
    );
  } catch (error: any) {
    const body = error?.meta?.body;
    console.error("Elasticsearch bulk index failed", {
      statusCode: error?.meta?.statusCode,
      errorType: body?.error?.type,
      reason: body?.error?.reason,
      causedBy: body?.error?.caused_by,
    });
    throw error;
  }
}

export async function searchElasticsearch(params: SearchParamsLite): Promise<EsSearchResult[]> {
  const es = getClient();
  if (!es) return [];
  await ensureIndex();

  const limit = Math.min(params.limit ?? 20, 100);
  const must: QueryDslQueryContainer[] = [
    {
      multi_match: {
        query: params.q,
        fields: [
          "title^2",
          "drugName^2",
          "brandName",
          "body",
          "treatmentPhase",
          "authorityMethod",
        ],
        type: "best_fields",
        operator: "and" as const,
      },
    },
  ];
  const filter: QueryDslQueryContainer[] = params.schedule
    ? [{ term: { scheduleCode: params.schedule } }]
    : [];

  const result = await es.search<EsSearchResult>(
    {
      index: ES_INDEX,
      size: limit,
      query: {
        bool: {
          must,
          filter,
        },
      },
      highlight: {
        fields: {
          body: { fragment_size: 280, number_of_fragments: 1 },
        },
      },
    },
    {
      // Force compatibility headers for ES 8 servers
      headers: {
        Accept: "application/vnd.elasticsearch+json; compatible-with=8",
        "Content-Type": "application/vnd.elasticsearch+json; compatible-with=8",
      },
    },
  );

  return (
    result.hits.hits.map((hit) => {
      const source = hit._source;
      const highlight = hit.highlight?.body?.[0];
      return {
        id: hit._id ?? "",
        title: source?.title ?? "",
        snippet: highlight ?? (source?.body ? source.body.slice(0, 320) : ""),
        pbsCode: source?.pbsCode ?? "",
        resCode: source?.resCode ?? "",
        scheduleCode: source?.scheduleCode ?? "",
        drugName: source?.drugName ?? "",
        brandName: source?.brandName ?? null,
        formulation: source?.formulation ?? null,
        programCode: source?.programCode ?? null,
        hospitalType: source?.hospitalType ?? null,
        authorityMethod: source?.authorityMethod ?? null,
        treatmentPhase: source?.treatmentPhase ?? null,
        streamlinedCode: source?.streamlinedCode ?? null,
        body: source?.body ?? null,
        score: hit._score ?? 0,
      };
    }) ?? []
  );
}
