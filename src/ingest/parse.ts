import Papa from "papaparse";

export interface ParsedTable<T extends Record<string, string> = Record<string, string>> {
  name: string;
  rows: T[];
}

export function parseCsvTable<T extends Record<string, string>>(
  csv: string,
  name: string,
): ParsedTable<T> {
  const parsed = Papa.parse<T>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    const details = parsed.errors.map((e) => e.message).join("; ");
    throw new Error(`Failed to parse CSV ${name}: ${details}`);
  }

  return { name, rows: parsed.data };
}
