import { withClient } from "../db/pool.js";

export interface EmbedOptions {
  scheduleCode: string;
  limit?: number;
}

export async function embedMissingDocs(
  _options: EmbedOptions,
): Promise<number> {
  const provider = process.env.EMBEDDINGS_PROVIDER;
  if (!provider) {
    console.log("No embeddings provider configured; skipping embedding step");
    return 0;
  }

  // Placeholder: hook up to external embedding provider here.
  await withClient(async () => {
    // Intentionally left blank for now.
  });

  return 0;
}
