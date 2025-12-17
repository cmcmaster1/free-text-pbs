import { ComposedDoc } from "./buildDocs.js";
import { withClient } from "../db/pool.js";

export interface ScheduleRecord {
  scheduleCode: string;
  effectiveDate: Date;
  sourceUrl: string;
}

async function upsertSchedule(schedule: ScheduleRecord): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `
        INSERT INTO pbs_schedule (schedule_code, effective_date, source_url)
        VALUES ($1, $2, $3)
        ON CONFLICT (schedule_code)
        DO UPDATE SET
          effective_date = EXCLUDED.effective_date,
          source_url = EXCLUDED.source_url,
          ingested_at = NOW()
      `,
      [schedule.scheduleCode, schedule.effectiveDate, schedule.sourceUrl],
    );
  });
}

async function upsertDocs(docs: ComposedDoc[]): Promise<number> {
  if (docs.length === 0) {
    return 0;
  }

  const columns = [
    "id",
    "schedule_code",
    "pbs_code",
    "res_code",
    "drug_name",
    "brand_name",
    "formulation",
    "program_code",
    "hospital_type",
    "authority_method",
    "treatment_phase",
    "streamlined_code",
    "title",
    "body",
    "source_json",
  ];

  const values: unknown[] = [];
  const placeholders: string[] = [];

  docs.forEach((doc, idx) => {
    const baseIndex = idx * columns.length;
    placeholders.push(
      `(${columns.map((_, colIdx) => `$${baseIndex + colIdx + 1}`).join(", ")})`,
    );
    values.push(
      doc.id,
      doc.scheduleCode,
      doc.pbsCode,
      doc.resCode,
      doc.drugName,
      doc.brandName ?? null,
      doc.formulation ?? null,
      doc.programCode ?? null,
      doc.hospitalType ?? null,
      doc.authorityMethod ?? null,
      doc.treatmentPhase ?? null,
      doc.streamlinedCode ?? null,
      doc.title,
      doc.body,
      doc.sourceJson ?? {},
    );
  });

  const query = `
    INSERT INTO pbs_doc (${columns.join(", ")})
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (schedule_code, pbs_code, res_code, brand_name)
    DO UPDATE SET
      drug_name = EXCLUDED.drug_name,
      brand_name = EXCLUDED.brand_name,
      formulation = EXCLUDED.formulation,
      program_code = EXCLUDED.program_code,
      hospital_type = EXCLUDED.hospital_type,
      authority_method = EXCLUDED.authority_method,
      treatment_phase = EXCLUDED.treatment_phase,
      streamlined_code = EXCLUDED.streamlined_code,
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      source_json = EXCLUDED.source_json
  `;

  await withClient(async (client) => {
    await client.query(query, values);
  });

  return docs.length;
}

export async function upsertScheduleAndDocs(
  schedule: ScheduleRecord,
  docs: ComposedDoc[],
): Promise<{ count: number }> {
  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        `
          INSERT INTO pbs_schedule (schedule_code, effective_date, source_url)
          VALUES ($1, $2, $3)
          ON CONFLICT (schedule_code)
          DO UPDATE SET
            effective_date = EXCLUDED.effective_date,
            source_url = EXCLUDED.source_url,
            ingested_at = NOW()
        `,
        [schedule.scheduleCode, schedule.effectiveDate, schedule.sourceUrl],
      );

      if (docs.length > 0) {
        const columns = [
          "id",
          "schedule_code",
          "pbs_code",
          "res_code",
          "drug_name",
          "brand_name",
          "formulation",
          "program_code",
          "hospital_type",
          "authority_method",
          "treatment_phase",
          "streamlined_code",
          "title",
          "body",
          "source_json",
        ];

        const values: unknown[] = [];
        const placeholders: string[] = [];

        docs.forEach((doc, idx) => {
          const baseIndex = idx * columns.length;
          placeholders.push(
            `(${columns.map((_, colIdx) => `$${baseIndex + colIdx + 1}`).join(", ")})`,
          );
          values.push(
            doc.id,
            doc.scheduleCode,
            doc.pbsCode,
            doc.resCode,
            doc.drugName,
            doc.brandName ?? null,
            doc.formulation ?? null,
            doc.programCode ?? null,
            doc.hospitalType ?? null,
            doc.authorityMethod ?? null,
            doc.treatmentPhase ?? null,
            doc.streamlinedCode ?? null,
            doc.title,
            doc.body,
            doc.sourceJson ?? {},
          );
        });

        await client.query(
          `
            INSERT INTO pbs_doc (${columns.join(", ")})
            VALUES ${placeholders.join(", ")}
            ON CONFLICT (schedule_code, pbs_code, res_code, brand_name)
            DO UPDATE SET
              drug_name = EXCLUDED.drug_name,
              brand_name = EXCLUDED.brand_name,
              formulation = EXCLUDED.formulation,
              program_code = EXCLUDED.program_code,
              hospital_type = EXCLUDED.hospital_type,
              authority_method = EXCLUDED.authority_method,
              treatment_phase = EXCLUDED.treatment_phase,
              streamlined_code = EXCLUDED.streamlined_code,
              title = EXCLUDED.title,
              body = EXCLUDED.body,
              source_json = EXCLUDED.source_json
          `,
          values,
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  return { count: docs.length };
}

export { upsertDocs, upsertSchedule };
