import { extractCsvEntries } from "./extract.js";
import { buildDocsFromTables } from "./buildDocs.js";
import { parseCsvTable } from "./parse.js";
import { downloadScheduleZip, resolveScheduleUrl } from "./download.js";
import { embedMissingDocs } from "./embed.js";
import { upsertScheduleAndDocs } from "./upsert.js";
import { indexDocsToElasticsearch } from "../search/elasticsearch.js";

export interface IngestOptions {
  targetDate?: string;
  lookbackMonths?: number;
}

export async function runIngest(options: IngestOptions = {}) {
  const targetDate = options.targetDate ? new Date(options.targetDate) : new Date();

  const resolved = await resolveScheduleUrl(
    targetDate,
    options.lookbackMonths,
    !options.targetDate,
  );
  console.log(`Resolved schedule ${resolved.scheduleCode} → ${resolved.url}`);

  const zipBuffer = await downloadScheduleZip(resolved.url);
  console.log(`Downloaded schedule (${zipBuffer.byteLength} bytes)`);

  const entries = await extractCsvEntries(zipBuffer);
  console.log(`Extracted ${entries.length} CSV file(s) from archive`);

  const tables = entries.map((entry) =>
    parseCsvTable<Record<string, string>>(entry.contents, entry.path),
  );

  const docs = buildDocsFromTables(tables, resolved.scheduleCode);
  console.log(`Composed ${docs.length} document(s)`);

  await upsertScheduleAndDocs(
    {
      scheduleCode: resolved.scheduleCode,
      effectiveDate: resolved.effectiveDate,
      sourceUrl: resolved.url,
    },
    docs,
  );

  await indexDocsToElasticsearch(docs, resolved.scheduleCode);

  await embedMissingDocs({ scheduleCode: resolved.scheduleCode });

  return {
    scheduleCode: resolved.scheduleCode,
    docs: docs.length,
  };
}
