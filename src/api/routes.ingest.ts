import { Router } from "express";
import type { Request } from "express";

import { runIngest } from "../ingest/run.js";

const router = Router();

function extractToken(req: Request): string | null {
  const headerToken = req.headers["x-admin-token"];
  if (typeof headerToken === "string") return headerToken;
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice("bearer ".length);
  }
  return null;
}

router.post("/admin/ingest", async (req, res) => {
  try {
    const expectedToken = process.env.ADMIN_INGEST_TOKEN;
    if (expectedToken) {
      const provided = extractToken(req);
      if (provided !== expectedToken) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const { targetDate, lookbackMonths } = req.body ?? {};
    const ingestResult = await runIngest({
      targetDate,
      lookbackMonths,
    });
    return res.json(ingestResult);
  } catch (err) {
    console.error("Ingest failed", err);
    return res.status(500).json({ error: "Ingest failed" });
  }
});

export default router;
