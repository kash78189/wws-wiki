/**
 * 万物书 · 编辑后台后端（Cloudflare Worker）
 *
 * 职责：
 *   1. 账号密码登录，签发 HMAC 签名会话令牌（无状态，不存数据库）
 *   2. 代理读写 GitHub 仓库（词条数据 + 图片上传）
 *   3. 托管后台前端静态资源（[assets] 绑定），使 Access 网关可以同源保护
 *
 * 前置防线：Cloudflare Access 网关（邮箱 OTP），在请求到达本 Worker 之前拦截。
 * 详见 worker/README.md
 */

const SESSION_TTL = 12 * 60 * 60 * 1000; // 12h
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
const fail = (msg, status = 400) => json({ error: msg }, status);

/* ------------------------------ 编码工具 ------------------------------ */
const b64urlBytes = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s) => b64urlBytes(enc.encode(s));
function fromB64url(s) {
  const bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
function b64encode(str) {
  const b = enc.encode(str);
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(s) {
  const bin = atob(String(s).replace(/\s/g, ""));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(b);
}
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s) => new Uint8Array(String(s).match(/../g).map((h) => parseInt(h, 16)));
function timingEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ------------------------------ 会话令牌 ------------------------------ */
const hmacKey = (secret) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

async function sign(payload, secret) {
  const data = b64urlStr(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data));
  return data + "." + b64urlBytes(sig);
}
async function verifyToken(token, secret) {
  if (!token || !secret || !token.includes(".")) return null;
  const i = token.lastIndexOf(".");
  const data = token.slice(0, i), sig = token.slice(i + 1);
  const expect = b64urlBytes(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data)));
  if (!timingEqual(sig, expect)) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(data)));
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch (e) { return null; }
}

/* ------------------------------ 密码校验 ------------------------------ */
async function derive(password, saltHex, iters) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: unhex(saltHex), iterations: iters, hash: "SHA-256" }, key, 256);
  return hex(bits);
}
async function checkPassword(env, username, password) {
  let users;
  try { users = JSON.parse(env.ADMIN_USERS || "{}"); } catch (e) { return false; }
  const rec = users[username];
  if (!rec || !rec.salt || !rec.hash) return false;
  const got = await derive(password, rec.salt, rec.iterations || 150000);
  return timingEqual(got, rec.hash);
}

/* ------------------------------ GitHub 代理 ------------------------------ */
function gh(env, path, init = {}) {
  return fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      authorization: "Bearer " + env.GITHUB_TOKEN,
      accept: "application/vnd.github+json",
      "user-agent": "wws-admin-worker",
      "x-github-api-version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
}
const contents = (env, p) => `/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${p}`;

/* ------------------------------ CORS ------------------------------ */
function corsHeaders(env, origin) {
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const h = {
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
  if (origin && (allowed.includes("*") || allowed.includes(origin))) h["access-control-allow-origin"] = origin;
  return h;
}

/* ------------------------------ 接口 ------------------------------ */
async function api(request, env, path) {
  const method = request.method;

  if (path === "/api/health") return json({ ok: true, service: "wws-admin", repo: `${env.GH_OWNER}/${env.GH_REPO}` });

  if (path === "/api/login" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const u = String(body.user || "").trim();
    const p = String(body.password || "");
    if (!u || !p) return fail("请输入用户名和密码", 400);
    if (!env.SESSION_SECRET || !env.ADMIN_USERS) return fail("后台尚未完成配置（缺少 SESSION_SECRET / ADMIN_USERS）", 500);
    if (!(await checkPassword(env, u, p))) {
      await sleep(700); // 拖慢暴力破解
      return fail("用户名或密码错误", 401);
    }
    const token = await sign({ u, exp: Date.now() + SESSION_TTL }, env.SESSION_SECRET);
    return json({ token, user: u, expiresIn: SESSION_TTL });
  }

  // 以下接口均需有效会话
  const authz = request.headers.get("Authorization") || "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  const sess = await verifyToken(bearer, env.SESSION_SECRET);
  if (!sess) return fail("未登录或会话已过期", 401);

  if (path === "/api/me") return json({ user: sess.u });
  if (path === "/api/logout" && method === "POST") return json({ ok: true });
  if (path === "/api/data" && method === "GET") return apiLoad(env);
  if (path === "/api/data" && method === "PUT") return apiSave(env, request, sess);
  if (path === "/api/upload" && method === "PUT") return apiUpload(env, request, sess);
  return fail("未知接口 " + path, 404);
}

async function apiLoad(env) {
  const p = env.DATA_PATH || "data/wws.json";
  const r = await gh(env, `${contents(env, p)}?ref=${env.GH_BRANCH || "main"}`);
  const j = await r.json();
  if (!r.ok) return fail("读取数据失败：" + (j.message || r.status), 502);
  return json({ sha: j.sha, data: JSON.parse(b64decode(j.content)) });
}

async function apiSave(env, request, sess) {
  const body = await request.json().catch(() => null);
  if (!body || !body.data) return fail("请求体无效", 400);
  const p = env.DATA_PATH || "data/wws.json";
  const message = String(body.message || "chore(admin): 更新词条数据").slice(0, 180) + ` [by ${sess.u}]`;
  const payload = { message, content: b64encode(JSON.stringify(body.data, null, 1)), branch: env.GH_BRANCH || "main" };
  if (body.sha) payload.sha = body.sha;
  const r = await gh(env, contents(env, p), { method: "PUT", body: JSON.stringify(payload) });
  const j = await r.json();
  if (r.status === 409) return json({ error: "数据已被其他人修改，请重新载入后再试", conflict: true }, 409);
  if (!r.ok) return fail("保存失败：" + (j.message || r.status), 502);
  return json({ sha: j.content && j.content.sha, commit: j.commit && j.commit.html_url });
}

async function apiUpload(env, request, sess) {
  const body = await request.json().catch(() => null);
  if (!body || !body.name || !body.content) return fail("请求体无效", 400);
  const name = String(body.name).replace(/[^a-zA-Z0-9._-]/g, "");
  if (!/^[a-f0-9]{8,40}\.(png|jpg|jpeg|webp|svg)$/i.test(name)) return fail("文件名不合法", 400);
  const branch = env.GH_BRANCH || "main";
  const path = `${env.IMAGES_PATH || "src/images"}/${name}`;

  const head = await gh(env, `${contents(env, path)}?ref=${branch}`);
  if (head.ok) return json({ path: "images/" + name, existed: true });

  const r = await gh(env, contents(env, path), {
    method: "PUT",
    body: JSON.stringify({ message: `chore(admin): 上传图片 ${name} [by ${sess.u}]`, content: body.content, branch }),
  });
  const j = await r.json();
  if (!r.ok) return fail("上传失败：" + (j.message || r.status), 502);
  return json({ path: "images/" + name, sha: j.content && j.content.sha });
}

/* ------------------------------ 入口 ------------------------------ */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(env, origin);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (path === "/") return Response.redirect(url.origin + "/admin/", 302);
      if (path.startsWith("/api/")) {
        const res = await api(request, env, path);
        for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
        return res;
      }
      if (!env.ASSETS) return new Response("静态资源未绑定", { status: 500 });
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: "服务器错误：" + (e && e.message) }, 500, cors);
    }
  },
};
