import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

import docRoutes from "./routes.doc.js";
import ingestRoutes from "./routes.ingest.js";
import metaRoutes from "./routes.meta.js";
import searchRoutes from "./routes.search.js";
import scheduleRoutes from "./routes.schedule.js";
import { pool } from "../db/pool.js";

config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "1mb" }));
// Serve the UI from the repo root /public (works in dist build too)
const publicDir = path.resolve(process.cwd(), "public");
app.use(express.static(publicDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/debug/db", async (_req, res) => {
  try {
    const start = Date.now();
    const result = await pool.query<{ now: string }>("select now()");
    const elapsed = Date.now() - start;
    const now = result.rows[0]?.now;
    return res.json({ ok: true, elapsedMs: elapsed, now });
  } catch (err) {
    console.error("DB ping failed", err);
    return res.status(500).json({ ok: false, error: "db ping failed" });
  }
});
app.use("/api", searchRoutes);
app.use("/api", docRoutes);
app.use("/api", ingestRoutes);
app.use("/api", metaRoutes);
app.use("/api", scheduleRoutes);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
