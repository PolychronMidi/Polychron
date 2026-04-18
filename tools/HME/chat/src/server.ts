import * as path from "path";
import * as fs from "fs";
import express from "express";
import cors from "cors";
import { BrowserPanel } from "./BrowserPanel";

const PORT = Number(process.env["HME_CHAT_PORT"] ?? 3131);
// Default: walk up from tools/HME/chat/out/ → Polychron root (3 levels up from __dirname)
const projectRoot = process.env["HME_PROJECT_ROOT"] ?? path.resolve(__dirname, "..", "..", "..", "..");

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

// ── Static HTML ──────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  const htmlPath = path.join(__dirname, "..", "webview", "browser.html");
  res.sendFile(htmlPath);
});

// ── SSE event stream ─────────────────────────────────────────────────────────

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const panel = BrowserPanel.createOrShow(projectRoot);
  panel.registerSseClient(res);

  req.on("close", () => {
    panel.unregisterSseClient(res);
  });
});

// ── Message dispatch ─────────────────────────────────────────────────────────

app.post("/api/message", (req, res) => {
  const panel = BrowserPanel.createOrShow(projectRoot);
  try {
    panel.handleMessage(req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`HME Chat listening on http://localhost:${PORT}`);
});

// Graceful shutdown
async function shutdown() {
  console.log("\n[HME] shutting down…");
  if (BrowserPanel.current) {
    await BrowserPanel.current.dispose();
  }
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
