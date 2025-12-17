import { runIngest } from "../ingest/run.js";

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function main() {
  const months = process.env.BACKFILL_MONTHS
    ? Number.parseInt(process.env.BACKFILL_MONTHS, 10)
    : 3;
  const count = Number.isFinite(months) && months > 0 ? months : 3;

  for (let i = 0; i < count; i += 1) {
    const target = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 1));
    // eslint-disable-next-line no-await-in-loop
    const result = await runIngest({ targetDate: toIso(target), lookbackMonths: 0 });
    console.log(`Backfill month ${result.scheduleCode} complete`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
