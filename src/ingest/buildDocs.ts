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

interface ItemRow {
  pbs_code: string;
  drug_name: string;
  brand_name?: string;
  li_form?: string;
  schedule_form?: string;
  program_code?: string;
  benefit_type_code?: string;
  schedule_code?: string;
}

interface RestrictionRow {
  res_code: string;
  treatment_phase?: string;
  authority_method?: string;
  restriction_number?: string;
  li_html_text?: string;
  schedule_html_text?: string;
  schedule_code?: string;
}

interface ItemRestrictionRow {
  res_code: string;
  pbs_code: string;
  benefit_type_code?: string;
  restriction_indicator?: string;
  res_position?: string;
  schedule_code?: string;
}

function normalizeRow(row: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), (v ?? "").toString().trim()]),
  );
}

function clean(val?: string | null): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return undefined;
  return trimmed;
}

function normalizeKeyPart(val?: string | null): string {
  return val ? val.trim().toLowerCase() : "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function requireTable(tables: ParsedTable[], filename: string): ParsedTable {
  const table = tables.find(
    (t) => t.name.toLowerCase().split("/").pop() === filename.toLowerCase(),
  );
  if (!table) {
    throw new Error(`Expected table ${filename} not found in archive`);
  }
  return table;
}

function pickText(restriction: RestrictionRow): string {
  return stripHtml(
    restriction.schedule_html_text ||
      restriction.li_html_text ||
      restriction.treatment_phase ||
      "",
  );
}

interface AggregatedDocState {
  drugName: string;
  resCode: string;
  authorityMethod?: string;
  treatmentPhase?: string;
  streamlinedCodes: Set<string>;
  programCodes: Set<string>;
  brandNames: Set<string>;
  formulations: Set<string>;
  pbsCodes: Set<string>;
  items: Map<string, ItemRow>;
  relationships: Map<string, ItemRestrictionRow>;
  restriction: RestrictionRow;
  bodyText: string;
}

export function buildDocsFromTables(
  tables: ParsedTable[],
  scheduleCode: string,
): ComposedDoc[] {
  const itemsTable = requireTable(tables, "items.csv");
  const restrictionsTable = requireTable(tables, "restrictions.csv");
  const itemResTable = requireTable(tables, "item-restriction-relationships.csv");

  const items = new Map<string, ItemRow>();
  itemsTable.rows.forEach((raw) => {
    const row = normalizeRow(raw);
    if (!row.pbs_code || !row.drug_name) return;
    items.set(row.pbs_code, {
      pbs_code: row.pbs_code,
      drug_name: row.drug_name,
      brand_name: clean(row.brand_name),
      li_form: clean(row.li_form),
      schedule_form: clean(row.schedule_form),
      program_code: clean(row.program_code),
      benefit_type_code: clean(row.benefit_type_code),
      schedule_code: clean(row.schedule_code),
    });
  });

  const restrictions = new Map<string, RestrictionRow>();
  restrictionsTable.rows.forEach((raw) => {
    const row = normalizeRow(raw);
    if (!row.res_code) return;
    restrictions.set(row.res_code, {
      res_code: row.res_code,
      treatment_phase: clean(row.treatment_phase),
      authority_method: clean(row.authority_method),
      restriction_number: clean(row.restriction_number),
      li_html_text: clean(row.li_html_text),
      schedule_html_text: clean(row.schedule_html_text),
      schedule_code: clean(row.schedule_code),
    });
  });

  const itemRestrictions: ItemRestrictionRow[] = [];
  itemResTable.rows.forEach((raw) => {
    const row = normalizeRow(raw);
    if (!row.res_code || !row.pbs_code) return;
    itemRestrictions.push({
      res_code: row.res_code,
      pbs_code: row.pbs_code,
      benefit_type_code: row.benefit_type_code,
      restriction_indicator: row.restriction_indicator,
      res_position: row.res_position,
      schedule_code: row.schedule_code,
    });
  });

  const aggregated = new Map<string, AggregatedDocState>();

  for (const rel of itemRestrictions) {
    const item = rel.pbs_code ? items.get(rel.pbs_code) : undefined;
    const restriction = rel.res_code ? restrictions.get(rel.res_code) : undefined;
    if (!item || !restriction) continue;

    const bodyText = pickText(restriction);
    if (!bodyText) continue;

    const keyParts = [
      scheduleCode,
      restriction.res_code,
      normalizeKeyPart(item.drug_name),
      normalizeKeyPart(restriction.authority_method),
      normalizeKeyPart(restriction.treatment_phase),
    ];
    const key = keyParts.join("|");

    const existing = aggregated.get(key);
    const streamlinedCode =
      restriction.authority_method && restriction.authority_method.toUpperCase().includes("STREAM")
        ? restriction.restriction_number
        : undefined;
    if (!existing) {
      const programCodes = new Set<string>();
      if (item.program_code) programCodes.add(item.program_code);
      const brandNames = new Set<string>();
      if (item.brand_name) brandNames.add(item.brand_name);
      const formulations = new Set<string>();
      if (item.li_form) formulations.add(item.li_form);
      if (item.schedule_form) formulations.add(item.schedule_form);
      const pbsCodes = new Set<string>();
      pbsCodes.add(item.pbs_code);

      const itemsMap = new Map<string, ItemRow>();
      itemsMap.set(item.pbs_code, item);

      const relKey = [
        rel.pbs_code ?? "",
        rel.res_code ?? "",
        rel.benefit_type_code ?? "",
        rel.restriction_indicator ?? "",
        rel.res_position ?? "",
      ].join("|");
      const relsMap = new Map<string, ItemRestrictionRow>();
      relsMap.set(relKey, rel);

      aggregated.set(key, {
        drugName: item.drug_name,
        resCode: restriction.res_code,
        authorityMethod: restriction.authority_method,
        treatmentPhase: restriction.treatment_phase,
        streamlinedCodes: new Set(streamlinedCode ? [streamlinedCode] : []),
        programCodes,
        brandNames,
        formulations,
        pbsCodes,
        items: itemsMap,
        relationships: relsMap,
        restriction,
        bodyText,
      });
    } else {
      if (item.program_code) existing.programCodes.add(item.program_code);
      if (item.brand_name) existing.brandNames.add(item.brand_name);
      if (item.li_form) existing.formulations.add(item.li_form);
      if (item.schedule_form) existing.formulations.add(item.schedule_form);
      existing.pbsCodes.add(item.pbs_code);
      existing.items.set(item.pbs_code, item);
      if (streamlinedCode) existing.streamlinedCodes.add(streamlinedCode);

      const relKey = [
        rel.pbs_code ?? "",
        rel.res_code ?? "",
        rel.benefit_type_code ?? "",
        rel.restriction_indicator ?? "",
        rel.res_position ?? "",
      ].join("|");
      existing.relationships.set(relKey, rel);
    }
  }

  const docs: ComposedDoc[] = [];

  for (const group of aggregated.values()) {
    const brandNames = Array.from(group.brandNames).filter(Boolean).sort();
    const formulations = Array.from(group.formulations).filter(Boolean).sort();
    const pbsCodes = Array.from(group.pbsCodes).filter(Boolean).sort();
    const programCodes = Array.from(group.programCodes).filter(Boolean).sort();
    const itemsList = Array.from(group.items.values()).sort((a, b) =>
      a.pbs_code.localeCompare(b.pbs_code),
    );
    const relationshipsList = Array.from(group.relationships.values()).sort((a, b) => {
      const resCompare = (a.res_code ?? "").localeCompare(b.res_code ?? "");
      if (resCompare !== 0) return resCompare;
      return (a.pbs_code ?? "").localeCompare(b.pbs_code ?? "");
    });

    const authorityMethod = group.authorityMethod;
    const treatmentPhase = group.treatmentPhase;
    const titleParts = [group.drugName, treatmentPhase, authorityMethod].filter(Boolean);
    const title = titleParts.join(" — ") || group.drugName;

    const bodyLines = [
      `Drug: ${group.drugName}`,
      brandNames.length > 0 ? `Brand(s): ${brandNames.join("; ")}` : null,
      formulations.length > 0 ? `Form(s): ${formulations.join("; ")}` : null,
      pbsCodes.length > 0 ? `PBS code(s): ${pbsCodes.join(", ")}` : null,
      authorityMethod ? `Authority: ${authorityMethod}` : null,
      treatmentPhase ? `Phase: ${treatmentPhase}` : null,
      `Restriction text: ${group.bodyText}`,
    ].filter(Boolean) as string[];

    docs.push({
      id: randomUUID(),
      scheduleCode,
      pbsCode: pbsCodes[0] ?? group.resCode,
      resCode: group.resCode,
      drugName: group.drugName,
      brandName: brandNames.join("; ") || undefined,
      formulation: formulations.join("; ") || undefined,
      programCode: programCodes[0],
      hospitalType: undefined,
      authorityMethod,
      treatmentPhase,
      streamlinedCode: Array.from(group.streamlinedCodes).join("; ") || undefined,
      title,
      body: bodyLines.join("\n"),
      sourceJson: {
        restriction: group.restriction,
        items: itemsList,
        relationships: relationshipsList,
        pbs_codes: pbsCodes,
        brand_names: brandNames,
        formulations,
        program_codes: programCodes,
        streamlined_codes: Array.from(group.streamlinedCodes),
      },
    });
  }

  return docs;
}
