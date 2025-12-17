import { runIngest } from "../ingest/run.js";

async function main() {
  const result = await runIngest();
  console.log("Ingest complete", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
