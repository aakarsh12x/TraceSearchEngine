// last updated: 2026-07-28
import 'dotenv/config';
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { search, syncIndex, forceSync } from "./index-manager.js";
import { crawl } from "./crawler.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_API_KEY;

// ── Security Headers Middleware ────────────────────────────────────────────────
app.disable("x-powered-by");
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// ── Rate Limiting (In-Memory sliding window per IP) ───────────────────────────
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function rateLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now > record.resetTime) {
      rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (record.count >= maxRequests) {
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }

    record.count++;
    next();
  };
}

// Periodically clean up stale rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60_000);

// ── Admin Authorization Middleware ─────────────────────────────────────────────
function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  if (!ADMIN_SECRET) {
    console.warn("[SECURITY WARNING] Admin endpoints accessed, but ADMIN_SECRET is not set in environment.");
    return res.status(403).json({ error: "Admin access disabled: ADMIN_SECRET environment variable not configured." });
  }

  const providedKey = req.headers["x-admin-key"] || req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
  if (providedKey !== ADMIN_SECRET) {
    return res.status(401).json({ error: "Unauthorized: Invalid Admin API Key" });
  }

  next();
}

// ── IST time-window helpers ──────────────────────────────────────────────────
function getISTHour(): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(formatter.format(new Date()), 10) % 24;
}

function isActiveHours(): boolean {
  const hour = getISTHour();
  return hour >= 9 && hour < 21;
}

// ── Setup App Middleware ──────────────────────────────────────────────────────
let indexReady = false;

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);

app.use(express.json({ limit: "50kb" }));

// Apply rate limits: 60 search requests/min, 10 crawler requests/min per IP
app.use("/search", rateLimiter(60, 60_000));
app.use("/crawler/", rateLimiter(10, 60_000));

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/", (_req: Request, res: Response) => {
  res.send("Search Engine Backend Running");
});

app.get("/health", (_req: Request, res: Response) => {
  const active = isActiveHours();
  res.json({
    status: active ? "ok" : "sleeping",
    activeHours: "09:00–21:00 IST",
    istHour: getISTHour(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/status", (_req: Request, res: Response) => {
  res.json({ indexReady });
});

app.get("/search", async (req: Request, res: Response) => {
  try {
    const rawQuery = req.query.q;

    if (typeof rawQuery !== "string" || !rawQuery.trim()) {
      return res.status(400).json({ error: "Query missing or invalid" });
    }

    const query = rawQuery.trim().slice(0, 300); // cap query length to prevent DoS

    console.log(`[SEARCH] Query: "${query}"`);
    const { results, total } = await search(query);

    return res.json({ results, total });
  } catch (err) {
    console.error("[ERROR] Search failed:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Admin endpoint to start crawler
app.post("/crawler/start", requireAdminAuth, async (req: Request, res: Response) => {
  const { seedUrl } = req.body;

  if (typeof seedUrl !== "string" || !seedUrl.trim()) {
    return res.status(400).json({ error: "seedUrl is required and must be a string" });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(seedUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: "Only http and https protocols are allowed" });
    }
  } catch {
    return res.status(400).json({ error: "Invalid seedUrl format" });
  }

  console.log(`[CRAWLER] Starting crawl for ${parsedUrl.href}...`);
  crawl(parsedUrl.href, { maxPages: 25, maxDepth: 2, source: "manual" }).catch((err) =>
    console.error("[CRAWLER ERROR]", err)
  );

  return res.json({ message: "Crawler started in background", seedUrl: parsedUrl.href });
});

// Admin endpoint to start Reddit crawler
app.post("/crawler/reddit", requireAdminAuth, async (req: Request, res: Response) => {
  const { subreddits } = req.body;

  if (!Array.isArray(subreddits) || subreddits.length === 0) {
    return res.status(400).json({ error: "A non-empty 'subreddits' array is required" });
  }

  // Validate subreddit names format (alphanumeric and underscores only, 1-30 chars)
  const subredditRegex = /^[a-zA-Z0-9_]{1,30}$/;
  const sanitizedSubreddits: string[] = [];

  for (const item of subreddits) {
    if (typeof item !== "string" || !subredditRegex.test(item.trim())) {
      return res.status(400).json({ error: `Invalid subreddit name: ${String(item)}` });
    }
    sanitizedSubreddits.push(item.trim());
  }

  console.log(`[REDDIT CRAWLER] Starting crawl for: ${sanitizedSubreddits.join(", ")}`);

  try {
    const { crawlReddit } = await import("./reddit-crawler.js");
    crawlReddit(sanitizedSubreddits).catch((err) => console.error("[REDDIT CRAWLER ERROR]", err));
    return res.json({ message: "Reddit crawler started in background", subreddits: sanitizedSubreddits });
  } catch (err) {
    console.error("[REDDIT CRAWLER IMPORT ERROR]", err);
    return res.status(500).json({ error: "Failed to initialize Reddit crawler" });
  }
});

// Admin endpoint to re-sync FlexSearch index from DB
app.post("/admin/resync", requireAdminAuth, async (_req: Request, res: Response) => {
  console.log("\n[RE-SYNC] Manual re-sync triggered via /admin/resync...");
  try {
    await forceSync();
    res.json({ message: "Index re-synced successfully from database." });
  } catch (err) {
    console.error("[ERROR] Re-sync failed:", err);
    res.status(500).json({ error: "Re-sync failed" });
  }
});

// ── Self-managed keep-alive ───────────────────────────────────────────────────
let selfPingInterval: NodeJS.Timeout | null = null;

function startSelfPing(baseUrl: string): void {
  const INTERVAL_MS = 14 * 60 * 1_000;

  selfPingInterval = setInterval(async () => {
    if (!isActiveHours()) {
      console.log(`[IDLE] [${new Date().toISOString()}] Off-hours (IST ${getISTHour()}:xx) — skipping self-ping.`);
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (!res.ok) throw new Error(`HTTP status ${res.status}`);
      const data = (await res.json()) as { status: string; istHour: number };
      console.log(`[OK] [${new Date().toISOString()}] Self-ping OK — IST hour: ${data.istHour}, status: ${data.status}`);
    } catch (err) {
      console.error(`[ERROR] [${new Date().toISOString()}] Self-ping failed:`, err);
    }
  }, INTERVAL_MS);

  console.log(`[SCHEDULER] Self-ping scheduler started — active 09:00–21:00 IST`);
}

// ── Server Start & Lifecycle ─────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  console.log(`\nBackend Server initialized on port ${PORT}`);
  console.log(`Current IST Hour: ${getISTHour()}`);

  try {
    await syncIndex();
    indexReady = true;
    console.log(`Index is ready — /status returns { indexReady: true }`);
  } catch (err) {
    console.error("[CRITICAL ERROR] Failed to load index at startup:", err);
  }

  const selfUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  startSelfPing(selfUrl);
});

// Handle graceful shutdown
function gracefulShutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down server gracefully...`);
  if (selfPingInterval) clearInterval(selfPingInterval);
  server.close(() => {
    console.log("[SHUTDOWN] HTTP server closed.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
