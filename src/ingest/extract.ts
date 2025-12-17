import unzipper from "unzipper";

export interface ExtractedEntry {
  path: string;
  contents: string;
}

export async function extractCsvEntries(zipBuffer: Buffer): Promise<ExtractedEntry[]> {
  const directory = await unzipper.Open.buffer(zipBuffer);
  const csvEntries = directory.files.filter((entry) => entry.path.toLowerCase().endsWith(".csv"));

  const results: ExtractedEntry[] = [];
  for (const entry of csvEntries) {
    // eslint-disable-next-line no-await-in-loop
    const contents = await entry.buffer();
    results.push({ path: entry.path, contents: contents.toString("utf8") });
  }
  return results;
}
