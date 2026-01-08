import { Router } from "express";

import { latestScheduleInfo } from "../search/query.js";

const router = Router();

router.get("/meta", async (_req, res) => {
  try {
    const latestSchedule = await latestScheduleInfo();
    return res.json({ latestSchedule });
  } catch (err) {
    console.error("Meta lookup failed", err);
    return res.status(500).json({ error: "Meta lookup failed" });
  }
});

export default router;
