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
  const filename = `${scheduleCode}-01-PBS-API-CSV.zip`;
  return [
    `${base}/${year}/${month}/${filename}`,
    `${base}/${scheduleCode}.zip`,
    `${base}/${year}-${month}.zip`,
    `${base}/${year}${month}.zip`,
    `${base}/${year}/${month}/pbs-${year}-${month}.zip`,
    `${base}/pbs-${year}-${month}.zip`,
  ];
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; free-text-pbs/0.1; +https://github.com/cmcmaster1/free-text-pbs)";

function sanitizeHref(href: string): string {
  // Handles relative "../downloads/..." style hrefs seen on the PBS site.
  return href.replace("/../", "/");
}

async function scrapeDownloadsPage(base: string): Promise<ResolvedSchedule | null> {
  try {
    const res = await fetch(base, { headers: { "user-agent": USER_AGENT } });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/href="([^"]*PBS-API-CSV\\.zip)"/i);
    if (!match) return null;

    const [, rawHref] = match;
    if (!rawHref) return null;
    const href = sanitizeHref(rawHref);
    const url = new URL(href, base).toString();
    const dateMatch = href.match(/(\\d{4})-(\\d{2})-(\\d{2})-PBS-API-CSV\\.zip/i);
    if (!dateMatch) return null;
    const [_, yearStr, monthStr] = dateMatch; // eslint-disable-line @typescript-eslint/no-unused-vars
    const effectiveDate = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
    const scheduleCode = `${yearStr}-${monthStr}`;
    return { scheduleCode, effectiveDate, url };
  } catch (err) {
    console.warn("Failed to scrape downloads page", err);
    return null;
  }
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "user-agent": USER_AGENT } });
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

  const scraped = await scrapeDownloadsPage(base);
  if (scraped) {
    return scraped;
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
