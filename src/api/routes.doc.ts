import { Router } from "express";

import { getDocById } from "../search/query.js";

const router = Router();

router.get("/doc/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await getDocById(id);
    if (!doc) {
      return res.status(404).json({ error: "Not found" });
    }
    return res.json({ doc });
  } catch (err) {
    console.error("Doc lookup failed", err);
    return res.status(500).json({ error: "Lookup failed" });
  }
});

export default router;
