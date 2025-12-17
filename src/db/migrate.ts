import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pool, withClient } from "./pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations(): Promise<void> {
  const sqlDir = path.join(__dirname, "sql");
  const files = fs
    .readdirSync(sqlDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.warn("No migration files found in", sqlDir);
    return;
  }

  await withClient(async (client) => {
    for (const file of files) {
      const fullPath = path.join(sqlDir, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      console.log(`Running migration: ${file}`);
      await client.query(sql);
    }
  });
}

runMigrations()
  .then(() => {
    console.log("Migrations complete");
    return pool.end();
  })
  .catch((err) => {
    console.error("Migration failed", err);
    return pool.end().finally(() => process.exit(1));
  });
