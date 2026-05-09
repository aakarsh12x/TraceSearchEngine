// last updated: 2026-04-14
import 'dotenv/config';
import express from "express";
import cors from "cors";
import { search, syncIndex } from "./index-manager.js";
import { crawl } from "./crawler.js";

const app = express();
const PORT = process.env.PORT || 3001;

// ── Index readiness flag ──────────────────────────────────────────────────────
let indexReady = false;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Search Engine Backend Running");
});

// Keep-alive health check — pinged by Render cron job every 14 minutes
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Index readiness — polled by the frontend on startup
app.get("/status", (req, res) => {
  res.json({ indexReady });
});

app.get("/search", async (req, res) => {
  try {
    const query = req.query.q as string;

    if (!query) {
      return res.status(400).json({ error: "Query Missing" });
    }

    console.log(`Performing search across index for query: ${query}`);

    const { results, total } = await search(query);

    return res.json({ results, total });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Admin endpoint to start crawler
app.post("/crawler/start", async (req, res) => {
  const { seedUrl } = req.body;
  if (!seedUrl) {
    return res.status(400).json({ error: "seedUrl is required" });
  }
  
  console.log(`Starting crawl for ${seedUrl}...`);
  // Note: we purposely do not await this, so it runs in background.
  crawl(seedUrl, { maxPages: 25, maxDepth: 2, source: 'manual' }).catch(console.error);

  return res.json({ message: "Crawler started in background", seedUrl });
});

// Admin endpoint to start Reddit crawler
app.post("/crawler/reddit", async (req, res) => {
  const { subreddits } = req.body;
  if (!subreddits || !Array.isArray(subreddits) || subreddits.length === 0) {
    return res.status(400).json({ error: "A non-empty 'subreddits' array is required" });
  }

  console.log(`Starting Reddit crawl for: ${subreddits.join(', ')}`);
  
  // Dynamic import since snoowrap requires ESM sometimes, or just standard import is fine
  const { crawlReddit } = await import("./reddit-crawler.js");
  
  crawlReddit(subreddits).catch(console.error);

  return res.json({ message: "Reddit crawler started in background", subreddits });
});

// Admin endpoint to re-sync FlexSearch index from DB without restarting
app.post("/admin/resync", async (req, res) => {
  console.log("\n🔄 Manual re-sync triggered via /admin/resync...");
  try {
    await syncIndex();
    res.json({ message: "Index re-synced successfully from database." });
  } catch (err) {
    console.error("❌ Re-sync failed:", err);
    res.status(500).json({ error: "Re-sync failed" });
  }
});

// Sync index at setup time
app.listen(PORT, async () => {
  console.log(`\n🚀 Backend Server initialized on port ${PORT}`);
  console.log(`📡 Current Time: ${new Date().toISOString()}`);
  await syncIndex();
  indexReady = true;
  console.log(`✅ Index is ready — /status will now return { indexReady: true }`);
});
