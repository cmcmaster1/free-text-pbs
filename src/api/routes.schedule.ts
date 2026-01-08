import { Router } from "express";

import { listSchedules } from "../search/query.js";

const router = Router();

router.get("/schedules", async (_req, res) => {
  try {
    const schedules = await listSchedules();
    return res.json({ schedules });
  } catch (err) {
    console.error("Schedule lookup failed", err);
    return res.status(500).json({ error: "Schedule lookup failed" });
  }
});

export default router;
