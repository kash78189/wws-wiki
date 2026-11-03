/**
 * 后台前端自测（无头浏览器）
 *   node tools/test/run.mjs
 *
 * 用 Edge/Chrome 的 --dump-dom 跑两个页面，从 <title> 里读结果。
 * 找不到浏览器时跳过（返回 0），不阻塞 CI。
 */
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };

/* ---------- 找浏览器 ---------- */
const CANDIDATES = [
  process.env.EDGE_BIN, process.env.CHROME_BIN,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
const BROWSER = CANDIDATES.find((p) => p && existsSync(p));
if (!BROWSER) {
  console.log("⚠ 未找到 Edge/Chrome，跳过后台前端自测（可设 EDGE_BIN 指定路径）");
  process.exit(0);
}

/* ---------- 静态服务器 ---------- */
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  try {
    const buf = await readFile(join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("404");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

/* ---------- 跑一个用例 ---------- */
function run(url, budget = 9000) {
  const profile = join(tmpdir(), "wws-test-" + Math.random().toString(36).slice(2));
  return new Promise((resolve) => {
    const child = spawn(BROWSER, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--user-data-dir=" + profile, "--virtual-time-budget=" + budget, "--dump-dom", url,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), budget + 25000);
    child.on("close", async () => {
      clearTimeout(timer);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
      const m = out.match(/<title>([\s\S]*?)<\/title>/);
      resolve(m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() : "NO-TITLE");
    });
  });
}

const CASES = [
  ["静态模式后台（GitHub 令牌）", "tools/test/admin-github.html"],
  ["Worker 模式后台（账号密码）", "tools/test/admin-worker.html"],
];

console.log("\n后台前端自测（" + BROWSER.split(/[\\/]/).pop() + "）");
let fail = 0;
for (const [label, file] of CASES) {
  const title = await run(`http://127.0.0.1:${PORT}/${file}`);
  if (title.startsWith("PASS")) console.log(`  ✓ ${label}\n      ${title.slice(5)}`);
  else { console.log(`  ✗ ${label}\n      ${title}`); fail++; }
}
server.close();
console.log(`\n结果：${CASES.length - fail} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
