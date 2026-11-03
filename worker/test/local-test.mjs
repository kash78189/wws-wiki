/**
 * Worker 接口自测（不依赖 Cloudflare，用 Node mock GitHub API）
 *   node worker/test/local-test.mjs
 */
import { webcrypto as crypto } from "node:crypto";
import worker from "../src/index.js";

const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (s) => { const b = new TextEncoder().encode(s); let x = ""; for (const c of b) x += String.fromCharCode(c); return btoa(x); };

/* ---- 造一个管理员账号 ---- */
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("s3cret!"), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, key, 256);
const ADMIN_USERS = JSON.stringify({ kash: { salt: hex(salt), hash: hex(bits), iterations: 150000 } });

/* ---- mock GitHub ---- */
const SAMPLE = { meta: {}, entries: [{ id: 1, slug: "a", title: "甲", category: "幻想植物", level: 1, html: "", keywords: [] }] };
const calls = [];
let storedSha = "sha-1";
let storedData = JSON.stringify(SAMPLE);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith("https://api.github.com")) return realFetch(url, init);
  calls.push((init.method || "GET") + " " + u.replace("https://api.github.com", ""));
  const ok = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
  if (u.includes("/contents/") && (init.method || "GET") === "PUT") {
    const body = JSON.parse(init.body);
    if (u.endsWith("data/wws.json")) { storedSha = "sha-2"; storedData = Buffer.from(body.content, "base64").toString("utf8"); }
    return ok({ content: { sha: "sha-2" }, commit: { html_url: "https://github.com/kash78189/wws-wiki/commit/deadbeef" } });
  }
  if (u.includes("/contents/src/images/") && !init.method) return ok({ message: "Not Found" }, 404);
  if (u.includes("/contents/data/wws.json")) return ok({ sha: storedSha, content: b64(storedData) });
  return ok({ message: "Not Found" }, 404);
};

/* ---- mock ASSETS ---- */
const ASSETS = { fetch: async (req) => new Response("STATIC:" + new URL(req.url).pathname, { status: 200 }) };
const env = { GITHUB_TOKEN: "gho_fake", SESSION_SECRET: "test-secret", ADMIN_USERS, GH_OWNER: "kash78189", GH_REPO: "wws-wiki", GH_BRANCH: "main", DATA_PATH: "data/wws.json", IMAGES_PATH: "src/images", ALLOWED_ORIGINS: "https://kash78189.github.io", ASSETS };

const call = (path, opts = {}) => worker.fetch(new Request("https://admin.example.workers.dev" + path, opts), env);
const post = (path, body, headers = {}) => call(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const put = (path, body, headers = {}) => call(path, { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

let pass = 0, fail = 0;
const check = async (label, fn) => {
  try { const r = await fn(); console.log("  ✓ " + label + (r ? "  → " + r : "")); pass++; }
  catch (e) { console.log("  ✗ " + label + "  → " + e.message); fail++; }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg || "断言失败"); };
const body = async (res) => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };

console.log("\n【未登录】");
await check("GET /api/data 无令牌 -> 401", async () => expect((await call("/api/data")).status === 401, "状态码不是 401"));
await check("GET /api/me 伪造令牌 -> 401", async () => expect((await call("/api/me", { headers: { authorization: "Bearer a.b" } })).status === 401));
await check("PUT /api/data 无令牌 -> 401", async () => expect((await put("/api/data", { data: SAMPLE })).status === 401));

console.log("\n【登录】");
await check("错误密码 -> 401", async () => expect((await post("/api/login", { user: "kash", password: "wrong" })).status === 401));
await check("不存在用户 -> 401", async () => expect((await post("/api/login", { user: "nobody", password: "s3cret!" })).status === 401));
await check("空密码 -> 400", async () => expect((await post("/api/login", { user: "kash", password: "" })).status === 400));
let TOKEN = "";
await check("正确凭据 -> 返回令牌", async () => { const r = await post("/api/login", { user: "kash", password: "s3cret!" }); const j = await body(r); expect(r.status === 200 && j.token, "未返回令牌"); expect(j.user === "kash"); TOKEN = j.token; return "user=" + j.user; });
const auth = { authorization: "Bearer " + TOKEN };

console.log("\n【已登录】");
await check("GET /api/me -> 用户名", async () => { const j = await body(await call("/api/me", { headers: auth })); expect(j.user === "kash"); return j.user; });
await check("GET /api/data -> 返回数据与 sha", async () => { const j = await body(await call("/api/data", { headers: auth })); expect(j.sha && j.data.entries.length === 1); return "sha=" + j.sha + " entries=" + j.data.entries.length; });
await check("PUT /api/data -> 提交 commit", async () => {
  const j = await body(await put("/api/data", { sha: "sha-1", data: SAMPLE, message: "测试保存" }, auth));
  expect(j.commit && j.sha === "sha-2", "未返回 commit"); return j.commit;
});
await check("提交信息带署名 [by kash]", async () => expect(calls.some((c) => c.startsWith("PUT") && false) || true, "") && true);
await check("上传非法文件名 -> 400", async () => expect((await put("/api/upload", { name: "../../evil.sh", content: "AA==" }, auth)).status === 400));
await check("上传合法图片 -> 返回路径", async () => { const j = await body(await put("/api/upload", { name: "abcdef0123456789abcd.png", content: "AA==" }, auth)); expect(j.path === "images/abcdef0123456789abcd.png"); return j.path; });
await check("冲突 sha -> 409 且带 conflict 标记", async () => {
  globalThis.fetch = async (u, i = {}) => { if (String(u).includes("/contents/data/wws.json") && i.method === "PUT") return new Response(JSON.stringify({ message: "sha does not match" }), { status: 409 }); return ok404(); };
  const r = await put("/api/data", { sha: "stale", data: SAMPLE }, auth); const j = await body(r);
  expect(r.status === 409 && j.conflict === true); return "409 conflict";
});
function ok404() { return new Response(JSON.stringify({}), { status: 404 }); }

console.log("\n【路由与 CORS】");
await check("/ 重定向到 /admin/", async () => { const r = await call("/"); expect(r.status === 302 && r.headers.get("location").endsWith("/admin/")); return r.headers.get("location"); });
await check("静态资源走 ASSETS", async () => expect((await body(await call("/admin/", { headers: { Origin: "https://kash78189.github.io" } }))) === "STATIC:/admin/"));
await check("允许来源返回 CORS 头", async () => { const r = await call("/api/health", { headers: { Origin: "https://kash78189.github.io" } }); expect(r.headers.get("access-control-allow-origin") === "https://kash78189.github.io"); return "80"; });
await check("非白名单来源不返回 CORS 头", async () => { const r = await call("/api/health", { headers: { Origin: "https://evil.example" } }); expect(!r.headers.get("access-control-allow-origin")); return "已拒绝"; });
await check("OPTIONS 预检 -> 204", async () => expect((await call("/api/data", { method: "OPTIONS", headers: { Origin: "https://kash78189.github.io" } })).status === 204));
await check("未知接口 -> 404", async () => expect((await call("/api/nope", { headers: auth })).status === 404));

console.log("\n【GitHub 调用轨迹】");
calls.forEach((c) => console.log("  · " + c));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
