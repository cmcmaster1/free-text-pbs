import { Router } from "express";

import { searchDocs } from "../search/query.js";

const router = Router();

router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q as string) ?? "";
    const schedule = (req.query.schedule as string) ?? null;
    const limit = req.query.limit ? Number.parseInt(req.query.limit as string, 10) : undefined;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: "Missing query parameter q" });
    }

    const results = await searchDocs({ q, schedule, limit });
    return res.json({ results });
  } catch (err) {
    console.error("Search failed", err);
    return res.status(500).json({ error: "Search failed" });
  }
});

export default router;
