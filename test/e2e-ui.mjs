/** Drives ui/index.html in Firefox with the extension: search stations, scan, wait for results. */
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Builder, Browser, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3217;
const srv = spawn("node", ["ui/server.mjs"], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

const opts = new firefox.Options().setBinary(process.env.FF_BINARY || "/Applications/Firefox.app/Contents/MacOS/firefox").addArguments("-no-remote");
if (process.env.HEADLESS !== "0") opts.addArguments("-headless");
const d = await new Builder().forBrowser(Browser.FIREFOX).setFirefoxOptions(opts).build();
let ok = false;
try {
  await d.installAddon(path.join(root, "dist-firefox"), true);
  await d.get(`http://localhost:${PORT}/`);
  await d.wait(until.elementTextContains(d.findElement(By.id("extStatus")), "verbunden"), 15000);
  for (const [id, q] of [["from", "Berlin Hbf"], ["to", "München Hbf"]]) {
    await d.findElement(By.id(id)).sendKeys(q);
    const li = await d.wait(until.elementLocated(By.css(`#${id} ~ ul li`)), 10000);
    await d.wait(until.elementIsVisible(li), 5000);
    await li.click();
  }
  await d.findElement(By.id("scan")).click();
  // success = progress text advances beyond start with API calls and no error shown
  await d.wait(async () => /API-Calls: ([5-9]|\d{2,})/.test(await d.findElement(By.id("sub")).getText()), 90000);
  const msg = await d.findElement(By.id("msg")).getText();
  if (/Fehler/.test(msg)) throw new Error(msg);
  console.log("scan running, message:", msg);
  if (process.env.E2E_FULL) {
    await d.wait(until.elementLocated(By.css("#results .cfg")), 11 * 60000);
    console.log("first result:", (await d.findElement(By.css("#results .cfg")).getText()).replace(/\n/g, " | ").slice(0, 300));
  }
  console.log("PASS");
  ok = true;
} catch (e) { console.error("FAIL:", e.message); }
finally { await d.quit(); srv.kill(); }
process.exit(ok ? 0 : 1);
