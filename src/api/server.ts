import express from "express";
import { config } from "dotenv";

import docRoutes from "./routes.doc.js";
import ingestRoutes from "./routes.ingest.js";
import searchRoutes from "./routes.search.js";

config();

const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", searchRoutes);
app.use("/api", docRoutes);
app.use("/api", ingestRoutes);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
