/**
 * End-to-end test in real Firefox (selenium + geckodriver).
 *
 *   npm run build && node test/e2e-firefox.mjs
 *
 * Loads dist-firefox/ as a temporary add-on, serves a tiny page on
 * http://localhost:<port>/ (the dev manifest lets the content script run
 * there), posts `scan_start` to it exactly like bahnbrechend.net does and
 * waits for the first progress/result/error message from the background.
 * Real requests go to int.bahn.de, so this fails when bahn.de blocks us.
 *
 * Passes once >=6 API calls succeeded (E2E_FULL=1 waits for the whole scan).
 * Env: HEADLESS=0 to watch, FF_BINARY to override the Firefox path.
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, Browser } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FF = process.env.FF_BINARY || "/Applications/Firefox.app/Contents/MacOS/firefox";
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 120000);

const PAGE = `<!doctype html><meta charset=utf-8><title>e2e</title><body>
<script>
  window.__msgs = [];
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.source === "bahnbrechend-ext") window.__msgs.push(e.data);
  });
</script>`;

const server = http.createServer((_, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const opts = new firefox.Options().setBinary(FF).addArguments("-no-remote");
if (process.env.HEADLESS !== "0") opts.addArguments("-headless");
const driver = await new Builder().forBrowser(Browser.FIREFOX).setFirefoxOptions(opts).build();

let failed = false;
const fail = (m) => { console.error("FAIL:", m); failed = true; };

try {
  await driver.installAddon(path.join(root, "dist-firefox"), true);
  await driver.get(`http://localhost:${port}/`);
  await driver.sleep(1000);

  const post = (type, payload) => driver.executeScript(
    `window.postMessage({source:"bahnbrechend-web",requestId:arguments[0],type:arguments[1],payload:arguments[2]}, location.origin)`,
    crypto.randomUUID(), type, payload);

  await post("ping", {});
  await driver.wait(() => driver.executeScript("return window.__msgs.some(m=>m.type==='pong')"), 10000)
    .catch(() => fail("no pong — content script/background not reachable"));

  const date = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  await post("scan_start", { fromId: "8011160", toId: "8000261", date, topZPairs: [] });

  const deadline = Date.now() + TIMEOUT_MS;
  let seen = 0, outcome = null;
  while (Date.now() < deadline && !outcome) {
    await driver.sleep(1000);
    const msgs = await driver.executeScript("return window.__msgs");
    for (; seen < msgs.length; seen++) {
      const m = msgs[seen];
      if (m.type !== "pong") console.log(m.type, JSON.stringify(m.payload).slice(0, 200));
      if (m.type === "error" || m.type === "scan_complete") outcome = m;
      // Quick mode (default): enough successful bahn.de calls prove we're not blocked.
      if (!process.env.E2E_FULL && m.type === "progress" && m.payload.apiCallsDone >= 6) outcome = m;
      if (m.type === "scan_complete" && m.payload.scanData?.errorMessage) fail(`scan_complete with error: ${m.payload.scanData.errorMessage}`);
    }
  }
  if (!outcome) fail("timeout waiting for scan outcome");
  else if (outcome.type === "error") fail(`scan error: ${outcome.payload.message}`);
  else if (!failed) console.log("PASS: scan completed without API errors");
  try { await driver.executeScript(`window.postMessage({source:"bahnbrechend-web",requestId:"x1",type:"scan_cancel",payload:{}}, location.origin)`); } catch {}
} catch (e) {
  fail(e.stack || e);
} finally {
  await driver.quit();
  server.close();
}
process.exit(failed ? 1 : 0);
