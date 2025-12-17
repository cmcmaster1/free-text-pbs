import { randomUUID } from "node:crypto";

import { ParsedTable } from "./parse.js";

export interface ComposedDoc {
  id: string;
  scheduleCode: string;
  pbsCode: string;
  resCode: string;
  drugName: string;
  brandName?: string;
  formulation?: string;
  programCode?: string;
  hospitalType?: string;
  authorityMethod?: string;
  treatmentPhase?: string;
  streamlinedCode?: string;
  title: string;
  body: string;
  sourceJson: unknown;
}

function pickField(
  row: Record<string, string>,
  aliases: string[],
): string | undefined {
  for (const key of aliases) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function buildBody(row: Record<string, string>): string {
  const keys = Object.keys(row).sort();
  const lines = keys
    .map((key) => [key, row[key] ?? ""] as const)
    .filter(([, value]) => (value ?? "").toString().trim().length > 0)
    .map(([key, value]) => `${key}: ${value}`);
  return lines.join("\n");
}

export function buildDocsFromTables(
  tables: ParsedTable[],
  scheduleCode: string,
): ComposedDoc[] {
  const docs: ComposedDoc[] = [];
  const seenKeys = new Set<string>();

  for (const table of tables) {
    for (const rawRow of table.rows) {
      const row = Object.fromEntries(
        Object.entries(rawRow).map(([key, value]) => [key.trim(), value ?? ""]),
      );

      const pbsCode =
        pickField(row, ["pbs_code", "PBS Code", "Item Code", "item_code"]) ??
        pickField(row, ["PBS Item Code", "ItemNumber"]);
      const resCode =
        pickField(row, ["res_code", "Restriction Code", "restriction_code"]) ??
        pickField(row, ["RestrictionNo", "RES_NUMBER"]) ??
        pbsCode;
      const drugName =
        pickField(row, ["drug_name", "Drug Name", "Item Name", "Generic Name"]) ??
        pickField(row, ["MP Name", "MP_Name"]);

      if (!pbsCode || !resCode || !drugName) {
        continue;
      }

      const brandName = pickField(row, ["brand_name", "Brand Name"]);
      const formulation = pickField(row, ["formulation", "Formulation", "Form"]);
      const programCode = pickField(row, ["program_code", "Program Code"]);
      const hospitalType = pickField(row, ["hospital_type", "Hospital Type"]);
      const authorityMethod = pickField(row, ["authority_method", "Authority Type", "Authority Method"]);
      const treatmentPhase = pickField(row, ["treatment_phase", "Phase"]);
      const streamlinedCode = pickField(row, ["streamlined_code", "Streamlined Authority Code"]);

      const key = `${scheduleCode}:${pbsCode}:${resCode}:${brandName ?? ""}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);

      const body = buildBody(row);
      const titleParts = [drugName, treatmentPhase, authorityMethod]
        .filter(Boolean)
        .map((part) => part!.toString());
      const title = titleParts.join(" — ") || drugName;

      docs.push({
        id: randomUUID(),
        scheduleCode,
        pbsCode,
        resCode,
        drugName,
        brandName,
        formulation,
        programCode,
        hospitalType,
        authorityMethod,
        treatmentPhase,
        streamlinedCode,
        title,
        body,
        sourceJson: {
          table: table.name,
          row,
        },
      });
    }
  }

  return docs;
}
