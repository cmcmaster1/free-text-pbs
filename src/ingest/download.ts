import { fetch } from "undici";

export interface ResolvedSchedule {
  scheduleCode: string;
  effectiveDate: Date;
  url: string;
}

function formatScheduleCode(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function firstOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function getLookbackMonths(): number {
  const env = process.env.PBS_LOOKBACK_MONTHS;
  const parsed = env ? Number.parseInt(env, 10) : 6;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
}

function candidatePatterns(base: string, scheduleCode: string): string[] {
  const [year, month] = scheduleCode.split("-");
  return [
    `${base}/${scheduleCode}.zip`,
    `${base}/${year}-${month}.zip`,
    `${base}/${year}${month}.zip`,
    `${base}/${year}/${month}/pbs-${year}-${month}.zip`,
    `${base}/pbs-${year}-${month}.zip`,
  ];
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch (err) {
    console.warn(`HEAD ${url} failed`, err);
    return false;
  }
}

export async function resolveScheduleUrl(
  targetDate = new Date(),
  lookbackMonths = getLookbackMonths(),
): Promise<ResolvedSchedule> {
  const base = process.env.PBS_DOWNLOAD_BASE ?? "https://www.pbs.gov.au/downloads";
  const target = firstOfMonthUtc(targetDate);

  for (let i = 0; i <= lookbackMonths; i += 1) {
    const candidateDate = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() - i, 1));
    const scheduleCode = formatScheduleCode(candidateDate);
    const urls = candidatePatterns(base, scheduleCode);

    // Try the patterns in order, pick the first reachable one.
    // eslint-disable-next-line no-await-in-loop
    for (const url of urls) {
      // eslint-disable-next-line no-await-in-loop
      if (await headOk(url)) {
        return {
          scheduleCode,
          effectiveDate: candidateDate,
          url,
        };
      }
    }
  }

  throw new Error(`Unable to resolve PBS schedule url after looking back ${lookbackMonths} months`);
}

export async function downloadScheduleZip(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download PBS schedule ${url}: ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
