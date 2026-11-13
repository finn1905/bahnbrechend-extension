/**
 * Local test UI for the extension (replacement for bahnbrechend.net).
 *
 *   npm run build && npm run ui      ->  http://localhost:3000
 *
 * Serves ui/index.html and proxies station search to bahn.de (the browser
 * can't call it directly because of CORS). Scans themselves run inside the
 * extension, which is injected on http://localhost/* by the dev build.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const run = promisify(execFile);
// bahn.de's Akamai blocks Node's TLS fingerprint (403 even with a browser UA),
// but lets curl through — so station search shells out to curl.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0";

const cache = new Map();
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = path.join(os.tmpdir(), "bahnbrechend-ui-chrome");

async function viaCurl(api) {
  try {
    const { stdout } = await run("curl", ["-s", "--max-time", "10", "-w", "\n%{http_code}", "-H", `User-Agent: ${UA}`, api]);
    const nl = stdout.lastIndexOf("\n");
    if (Number(stdout.slice(nl + 1)) !== 200) return null;
    return JSON.parse(stdout.slice(0, nl));
  } catch { return null; }
}

// Akamai blocks curl's TLS fingerprint but lets a real Chrome through.
async function viaChrome(api) {
  try {
    const { stdout } = await run(CHROME, [
      "--headless=new", `--user-data-dir=${PROFILE}`, "--no-first-run", "--disable-gpu",
      "--virtual-time-budget=8000", "--dump-dom", api,
    ], { timeout: 30000, maxBuffer: 5e6 });
    const m = stdout.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
    if (!m) return null;
    const list = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
    return Array.isArray(list) ? list : null;
  } catch { return null; }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/stations") {
      const q = url.searchParams.get("q") || "";
      if (q.length < 2) return json(res, []);
      const key = q.toLowerCase();
      if (cache.has(key)) return json(res, cache.get(key));
      const api = `https://int.bahn.de/web/api/reiseloesung/orte?suchbegriff=${encodeURIComponent(q)}&typ=ALL&limit=8`;
      let list = await viaCurl(api);
      if (!list) list = await viaChrome(api);
      if (!list) return json(res, { error: "bahn.de blockiert (curl 403, Chrome-Fallback fehlgeschlagen)" }, 502);
      const out = list.filter((s) => s.extId && s.name).map((s) => ({ id: s.extId, name: s.name, type: s.type }));
      cache.set(key, out);
      return json(res, out);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(await readFile(path.join(dir, "index.html")));
    }
    res.writeHead(404).end("not found");
  } catch (e) {
    json(res, { error: String(e) }, 500);
  }
}).listen(PORT, "127.0.0.1", () => console.log(`UI läuft auf http://localhost:${PORT}`));

function json(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
