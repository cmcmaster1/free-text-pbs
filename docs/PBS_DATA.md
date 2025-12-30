# PBS Data Reference (CSV Inputs)

This app ingests the monthly PBS API CSV ZIP and composes searchable documents from a small
subset of the CSVs. The ingestion code only depends on the files/columns listed here.

## Zip layout assumptions

- The ZIP contains multiple CSV files; filenames are matched case-insensitively.
- Required filenames (by basename): `items.csv`, `restrictions.csv`, `item-restriction-relationships.csv`.
- Column names are normalized to lowercase and trimmed.
- Empty strings or the literal `null` (case-insensitive) are treated as missing.

## Required CSV files and joins

| CSV file | Required columns | Join keys | Purpose |
| --- | --- | --- | --- |
| `items.csv` | `pbs_code`, `drug_name` | `pbs_code` | Item metadata (drug name, brand, form, program). |
| `restrictions.csv` | `res_code` | `res_code` | Restriction metadata and text (HTML fragments). |
| `item-restriction-relationships.csv` | `pbs_code`, `res_code` | `pbs_code` + `res_code` | Links items to restrictions. |

Relationships are built by joining `item-restriction-relationships.csv` to:
- `items.csv` on `pbs_code`
- `restrictions.csv` on `res_code`

Rows missing required join keys are skipped.

## `items.csv`

Columns used:

| Column | Required | Used for | Notes |
| --- | --- | --- | --- |
| `pbs_code` | yes | Join key; stored in `pbs_doc.pbs_code` and body | Must be present for the row to be used. |
| `drug_name` | yes | Title/body; grouping key | Primary display name. |
| `brand_name` | no | Title/body; `pbs_doc.brand_name` | Aggregated across related items. |
| `li_form` | no | Body; `pbs_doc.formulation` | Aggregated into formulation list. |
| `schedule_form` | no | Body; `pbs_doc.formulation` | Aggregated into formulation list. |
| `program_code` | no | `pbs_doc.program_code` | First program code is kept; all are traced. |
| `benefit_type_code` | no | `source_json.items` | Trace-only. |
| `schedule_code` | no | `source_json.items` | Trace-only. |

## `restrictions.csv`

Columns used:

| Column | Required | Used for | Notes |
| --- | --- | --- | --- |
| `res_code` | yes | Join key; `pbs_doc.res_code` | Required for linking. |
| `treatment_phase` | no | Title/body; grouping key | Also used as a text fallback. |
| `authority_method` | no | Title/body; grouping key | If it contains `STREAM` (case-insensitive), `restriction_number` becomes the streamlined code. |
| `restriction_number` | no | `pbs_doc.streamlined_code` | Only used when `authority_method` indicates streamlined. |
| `schedule_html_text` | no | Body | Preferred restriction text (HTML stripped). |
| `li_html_text` | no | Body | Fallback restriction text (HTML stripped). |
| `schedule_code` | no | `source_json.restriction` | Trace-only. |

Restriction text selection (first non-empty wins):
1) `schedule_html_text`
2) `li_html_text`
3) `treatment_phase`

If no restriction text is available after this fallback, the restriction is skipped.

## `item-restriction-relationships.csv`

Columns used:

| Column | Required | Used for | Notes |
| --- | --- | --- | --- |
| `pbs_code` | yes | Join key | Must match a row in `items.csv`. |
| `res_code` | yes | Join key | Must match a row in `restrictions.csv`. |
| `benefit_type_code` | no | `source_json.relationships` | Trace-only. |
| `restriction_indicator` | no | `source_json.relationships` | Trace-only. |
| `res_position` | no | `source_json.relationships` | Trace-only. |
| `schedule_code` | no | `source_json.relationships` | Trace-only. |

## How these columns become `pbs_doc`

Composed documents are grouped by:
- schedule (from the ZIP URL)
- `res_code`
- `drug_name`
- `authority_method`
- `treatment_phase`

Within each group, the app aggregates:
- `brand_name` → `pbs_doc.brand_name` (semicolon-separated)
- `li_form` + `schedule_form` → `pbs_doc.formulation` (semicolon-separated)
- `program_code` → `pbs_doc.program_code` (first value)
- `restriction_number` → `pbs_doc.streamlined_code` (when streamlined)

The `pbs_doc.title` and `pbs_doc.body` are composed deterministically:
- `title`: `drug_name — treatment_phase — authority_method` (skipping missing parts)
- `body`: lines including drug, brands, forms, PBS codes, authority, phase, and restriction text

All contributing rows are preserved in `pbs_doc.source_json` for traceability.
