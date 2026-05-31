// last updated: 2026-05-30
import 'dotenv/config';
import express from "express";
import cors from "cors";
import { search, syncIndex, forceSync } from "./index-manager.js";
import { crawl } from "./crawler.js";

const app = express();
const PORT = process.env.PORT || 3001;

// ── IST time-window helpers ──────────────────────────────────────────────────
// Active hours: 09:00 – 21:00 IST (UTC+5:30)
// Outside this window the server lets itself idle on Render to save hours.

function getISTHour(): number {
  const now = new Date();
  // IST = UTC + 5h30m
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const istMs = utcMs + 5.5 * 60 * 60 * 1_000;
  return new Date(istMs).getHours();
}

/** Returns true between 09:00 and 20:59 IST (9 AM – 9 PM) */
function isActiveHours(): boolean {
  const hour = getISTHour();
  return hour >= 9 && hour < 21;
}

// ── Index readiness flag ──────────────────────────────────────────────────────
let indexReady = false;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Search Engine Backend Running");
});

// Keep-alive health check — pinged externally or by internal self-ping
app.get("/health", (req, res) => {
  const active = isActiveHours();
  res.json({
    status: active ? "ok" : "sleeping",
    activeHours: "09:00–21:00 IST",
    istHour: getISTHour(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
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
    await forceSync(); // always rebuilds from DB, ignores disk cache
    res.json({ message: "Index re-synced successfully from database." });
  } catch (err) {
    console.error("❌ Re-sync failed:", err);
    res.status(500).json({ error: "Re-sync failed" });
  }
});

// ── Self-managed keep-alive ───────────────────────────────────────────────────
// Pings /health every 14 minutes ONLY during active IST hours (09:00–21:00).
// This replaces the always-on Render cron job, saving ~12 hrs/day of cron usage.
function startSelfPing(baseUrl: string): void {
  const INTERVAL_MS = 14 * 60 * 1_000; // 14 minutes

  setInterval(async () => {
    if (!isActiveHours()) {
      console.log(`💤 [${new Date().toISOString()}] Off-hours (IST ${getISTHour()}:xx) — skipping self-ping to allow idle.`);
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      const data = await res.json() as { status: string; istHour: number };
      console.log(`✅ [${new Date().toISOString()}] Self-ping OK — IST hour: ${data.istHour}, status: ${data.status}`);
    } catch (err) {
      console.error(`❌ [${new Date().toISOString()}] Self-ping failed:`, err);
    }
  }, INTERVAL_MS);

  console.log(`⏰ Self-ping scheduler started — active 09:00–21:00 IST, silent 21:00–09:00 IST`);
}

// Sync index at setup time
app.listen(PORT, async () => {
  console.log(`\n🚀 Backend Server initialized on port ${PORT}`);
  console.log(`📡 Current Time: ${new Date().toISOString()}`);
  console.log(`🕐 Current IST Hour: ${getISTHour()}`);
  await syncIndex();
  indexReady = true;
  console.log(`✅ Index is ready — /status will now return { indexReady: true }`);

  // Start self-ping using the public Render URL (or localhost for dev)
  const selfUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  startSelfPing(selfUrl);
});
