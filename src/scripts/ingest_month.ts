import { runIngest } from "../ingest/run.js";

async function main() {
  const targetDate = process.argv[2];
  if (!targetDate) {
    console.error("Usage: npm run ingest:month -- YYYY-MM-DD");
    process.exit(1);
  }

  const result = await runIngest({ targetDate });
  console.log("Ingest complete", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
