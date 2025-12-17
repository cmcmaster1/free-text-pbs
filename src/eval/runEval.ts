import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import YAML from "yaml";

import { searchDocs } from "../search/query.js";

config();

interface EvalExpectation {
  drug?: string;
  contains?: string[];
}

interface EvalCase {
  q: string;
  expect: EvalExpectation;
}

function loadCases(): EvalCase[] {
  const filePath = path.resolve(process.cwd(), "src/eval/queries.yaml");
  const raw = fs.readFileSync(filePath, "utf8");
  const data = YAML.parse(raw);
  return data as EvalCase[];
}

function checkCase(expect: EvalExpectation, snippets: string[]): boolean {
  if (expect.contains) {
    const allMatch = expect.contains.every((fragment) =>
      snippets.some((snippet) => snippet.toLowerCase().includes(fragment.toLowerCase())),
    );
    if (!allMatch) return false;
  }
  return true;
}

async function runCase(testCase: EvalCase): Promise<boolean> {
  const results = await searchDocs({ q: testCase.q, limit: 5 });
  if (results.length === 0) {
    console.warn(`No results for "${testCase.q}"`);
    return false;
  }
  const snippets = results.map((r) => `${r.title}\n${r.snippet}`);
  if (testCase.expect.drug) {
    const hit = results.some(
      (r) => r.drugName.toLowerCase().includes(testCase.expect.drug!.toLowerCase()),
    );
    if (!hit) return false;
  }
  return checkCase(testCase.expect, snippets);
}

async function main() {
  const cases = loadCases();
  let passed = 0;

  for (const testCase of cases) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await runCase(testCase);
    passed += ok ? 1 : 0;
    console.log(`${ok ? "✅" : "❌"} ${testCase.q}`);
  }

  console.log(`Passed ${passed}/${cases.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
