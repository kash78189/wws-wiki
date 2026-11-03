/**
 * 万物书 · 幻想图鉴 —— 静态站点生成器
 * 读取 data/wws.json，输出到 dist/（纯静态，适配 GitHub Pages 子路径）
 */
import { mkdir, writeFile, cp, rm, readFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { adminHtml } from "./admin-html.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const DATA = join(ROOT, "data", "wws.json");

/* ============================ 站点配置 ============================ */
export const CONFIG = {
  name: "万物书",
  subtitle: "幻想图鉴",
  latin: "Codex of All Things",
  tagline: "饥荒联机版 · 万物书模组资料站",
  // 部署后可在此填写，用于 sitemap / 404；也可用环境变量覆盖
  siteUrl: process.env.SITE_URL || "",
  repoUrl: process.env.REPO_URL || "https://github.com/",
  sourceUrl: "https://wiki.alan.plus/#/?type=wws",
  workshopUrl: "https://steamcommunity.com/sharedfiles/filedetails/?id=3158409336",
  // —— 编辑后台（以 GitHub 仓库作为后端） ——
  repo: {
    owner: process.env.GH_OWNER || "",
    name: process.env.GH_REPO || "",
    branch: process.env.GH_BRANCH || process.env.GITHUB_REF_NAME || "main",
  },
  // 留空 = 以仓库写权限为准；填写后为额外白名单（GitHub 用户名）
  admins: (process.env.GH_ADMINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  // 可选：GitHub OAuth App 的 client_id（启用“设备码登录”）
  oauthClientId: process.env.GH_OAUTH_CLIENT_ID || "",
  dataPath: "data/wws.json",
  imagesPath: "src/images",
};

/* ============================ 工具函数 ============================ */
export const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

export const attr = (s = "") => esc(s).replace(/\n/g, " ");

/** 分类 slug：FNV-1a 32bit，与编辑后台保持一致 */
export const catSlug = (name) => {
  let x = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) { x ^= name.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return "cat-" + (x >>> 0).toString(16).padStart(8, "0");
};

/** 由词条自动归纳分类，hint 仅用于保留原有顺序 */
export function buildCategories(entries, hint = []) {
  const counts = new Map();
  for (const e of entries) counts.set(e.category, (counts.get(e.category) || 0) + 1);
  const order = new Map(hint.map((c, i) => [typeof c === "string" ? c : c.name, i]));
  return [...counts.keys()]
    .map((name) => ({ name, slug: catSlug(name), count: counts.get(name), order: order.has(name) ? order.get(name) : 9999 }))
    .sort((a, b) => a.order - b.order || b.count - a.count || a.name.localeCompare(b.name, "zh"));
}

const LOGO = `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3cd90"/><stop offset="1" stop-color="#c98f3d"/></linearGradient></defs><circle cx="24" cy="24" r="22" stroke="url(#lg)" stroke-opacity=".45" stroke-width="1.4"/><path d="M24 15c-3.4-2.2-7.6-2.9-11.6-2.9-.9 0-1.4.6-1.4 1.5v17.6c0 .9.6 1.5 1.5 1.4 3.7-.2 7.8.5 11.5 2.6V15z" fill="url(#lg)" fill-opacity=".16" stroke="url(#lg)" stroke-width="1.5" stroke-linejoin="round"/><path d="M24 15c3.4-2.2 7.6-2.9 11.6-2.9.9 0 1.4.6 1.4 1.5v17.6c0 .9-.6 1.5-1.5 1.4-3.7-.2-7.8.5-11.5 2.6V15z" fill="url(#lg)" fill-opacity=".16" stroke="url(#lg)" stroke-width="1.5" stroke-linejoin="round"/><path d="M24 15v20.2" stroke="url(#lg)" stroke-width="1.5" stroke-linecap="round"/><path d="M24 20.5v-4.6" stroke="url(#lg)" stroke-width="1.7" stroke-linecap="round"/><path d="M24 17.6c-1.7-.2-3.3-1.3-4.1-3.1 2-.3 3.6.5 4.1 2.2" fill="url(#lg)" fill-opacity=".5" stroke="url(#lg)" stroke-width="1.3" stroke-linejoin="round"/><path d="M24 17.6c1.7-.2 3.3-1.3 4.1-3.1-2-.3-3.6.5-4.1 2.2" fill="url(#lg)" fill-opacity=".5" stroke="url(#lg)" stroke-width="1.3" stroke-linejoin="round"/><circle cx="15" cy="28" r="1.1" fill="url(#lg)"/><circle cx="33" cy="28" r="1.1" fill="url(#lg)"/><circle cx="18" cy="34" r=".8" fill="url(#lg)" fill-opacity=".7"/><circle cx="30" cy="34" r=".8" fill="url(#lg)" fill-opacity=".7"/></svg>`;

/* ============================ 页面骨架 ============================ */
export function layout({ rel = "", title, description = "", active = "", page = "", body, og = {} }) {
  const fullTitle = title === CONFIG.name ? `${CONFIG.name} · ${CONFIG.subtitle}` : `${title} · ${CONFIG.name}图鉴`;
  const home = `${rel}index.html`;
  const about = `${rel}about.html`;
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(description || CONFIG.tagline)}">
<meta name="color-scheme" content="dark light">
<meta property="og:title" content="${attr(fullTitle)}">
<meta property="og:description" content="${attr(description || CONFIG.tagline)}">
<meta property="og:type" content="website">
${og.image ? `<meta property="og:image" content="${attr(og.image)}">` : ""}
<link rel="icon" type="image/svg+xml" href="${rel}assets/logo.svg">
<link rel="stylesheet" href="${rel}assets/styles.css">
</head>
<body data-page="${page}">
<a class="skip" href="#main" hidden>跳到主要内容</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${home}" aria-label="${CONFIG.name}首页">
      ${LOGO}
      <span class="brand-name"><b>${CONFIG.name}</b><small>${CONFIG.latin}</small></span>
    </a>
    <form class="header-search" id="global-search-form" role="search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
      <input id="global-search" type="search" placeholder="搜索词条…" aria-label="搜索词条" autocomplete="off">
      <kbd>/</kbd>
    </form>
    <nav class="header-nav">
      <a href="${home}" class="${active === "home" ? "active" : ""}">图鉴</a>
      <a href="${about}" class="${active === "about" ? "active" : ""}">关于</a>
      <button class="icon-btn" id="theme-toggle" type="button" aria-label="切换主题"></button>
    </nav>
  </div>
</header>
${body}
<footer class="site-footer">
  <div class="wrap">
    <span>© ${new Date().getFullYear()} ${CONFIG.name}·${CONFIG.subtitle} — 玩家资料站，非官方作品</span>
    <div class="foot-links">
      <a href="${CONFIG.sourceUrl}" target="_blank" rel="noopener">数据来源</a>
      <a href="${CONFIG.workshopUrl}" target="_blank" rel="noopener">创意工坊</a>
      <a href="${about}">关于本站</a>
      ${CONFIG.repoUrl ? `<a href="${CONFIG.repoUrl}" target="_blank" rel="noopener">GitHub</a>` : ""}
      <a href="${rel}admin/index.html" rel="nofollow" title="管理员入口" style="opacity:.5">管理</a>
    </div>
  </div>
</footer>
<script src="${rel}assets/app.js" defer></script>
</body>
</html>`;
}

/* ============================ 词条卡片 ============================ */
export function card(entry, rel, order) {
  const kw = [entry.category, ...entry.keywords.map((k) => k.title)].join(" ");
  return `<article class="card" data-order="${order}" data-cat="${attr(entry.categorySlug)}"
  data-title="${attr(entry.title)}" data-code="${attr(entry.code)}" data-created="${attr(entry.createdAt || "")}"
  data-keywords="${attr(kw)}" data-excerpt="${attr(entry.excerpt)}">
  <div class="card-icon">${entry.image ? `<img src="${rel}${entry.image}" alt="" loading="lazy" decoding="async">` : ""}</div>
  <div class="card-body">
    <h3 class="card-title">${esc(entry.title)}</h3>
    <div class="card-cat">${esc(entry.category)}</div>
    <p class="card-excerpt">${esc(entry.excerpt)}</p>
  </div>
  <a class="card-link" href="${rel}e/${entry.slug}.html" aria-label="查看 ${attr(entry.title)}"></a>
</article>`;
}
/* ============================ 首页 ============================ */
export function homePage(data) {
  const entries = data.entries;
  const cats = data.categories;
  const rel = "";
  const cards = entries.map((e, i) => card(e, rel, i)).join("\n");
  const chips = [
    `<button class="chip active" data-cat="*" data-name="全部" aria-pressed="true">全部 <i>${entries.length}</i></button>`,
    ...cats.map(
      (c) => `<button class="chip" data-cat="${attr(c.slug)}" data-name="${attr(c.name)}" aria-pressed="false">${esc(c.name)} <i>${c.count}</i></button>`
    ),
  ].join("\n");

  const body = `<main id="main">
<section class="hero wrap">
  <div class="hero-rune">${CONFIG.tagline}</div>
  <h1>${CONFIG.name}</h1>
  <p class="sub">收录 <b>${entries.length}</b> 个词条，遍及幻想岛屿、植物、建筑、道具、装饰、料理与魔法药剂——万物之名，皆载于此。</p>
  <div class="stats">
    <div class="stat"><b>${entries.length}</b><span>词条</span></div>
    <div class="stat"><b>${cats.length}</b><span>分类</span></div>
    <div class="stat"><b>${entries.reduce((n, e) => n + e.keywords.length, 0)}</b><span>关联</span></div>
  </div>
  <div class="hero-search">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
    <input id="hero-search-input" type="search" placeholder="搜索词条名称、prefab 代号或正文内容…" aria-label="搜索词条" autocomplete="off">
    <span class="hint"><kbd>/</kbd></span>
  </div>
</section>

<div class="toolbar">
  <div class="wrap toolbar-inner">
    <div class="chips" id="chips">${chips}</div>
    <div class="sortbox">
      <select id="sort" aria-label="排序方式">
        <option value="default">默认排序</option>
        <option value="name">按名称</option>
        <option value="new">按更新</option>
      </select>
    </div>
    <div class="result-note" id="note"></div>
  </div>
</div>

<div class="wrap">
  <div class="grid" id="grid">${cards}</div>
  <div class="empty" id="empty" hidden><b>没有找到相关词条</b>换个关键词，或点击「全部」看看。</div>
</div>
</main>`;

  return layout({
    rel,
    page: "home",
    active: "home",
    title: CONFIG.name,
    description: `${CONFIG.name}模组资料站，收录 ${entries.length} 个词条：${cats.slice(0, 5).map((c) => c.name).join("、")} 等。`,
    body,
  });
}

/* ============================ 词条页 ============================ */
export function entryPage(entry, cat, data) {
  const rel = "../";
  const html = entry.html.replace(/@@entry\/([a-zA-Z0-9_-]+)@@/g, (_, s) => `${rel}e/${s}.html`);
  const catEntries = data.entriesByCat[entry.categorySlug] || [];
  const idx = catEntries.findIndex((e) => e.slug === entry.slug);
  const prev = catEntries[idx - 1];
  const next = catEntries[idx + 1];

  const related = entry.keywords.length
    ? `<h2 class="section-title">关联词条 <span class="count">${entry.keywords.length}</span><span class="line"></span></h2>
<div class="related">${entry.keywords
        .map((k) => {
          const inner = `<span class="rel-img">${k.image ? `<img src="${rel}${k.image}" alt="" loading="lazy">` : ""}</span><span class="rel-title">${esc(k.title)}</span>`;
          return k.slug
            ? `<a class="rel" href="${rel}e/${k.slug}.html">${inner}</a>`
            : `<div class="rel is-plain">${inner}</div>`;
        })
        .join("")}</div>`
    : "";

  const pager = `<nav class="pager">${
    prev ? `<a href="${rel}e/${prev.slug}.html"><small>← 上一个</small><b>${esc(prev.title)}</b></a>` : "<span></span>"
  }${
    next ? `<a class="next" href="${rel}e/${next.slug}.html"><small>下一个 →</small><b>${esc(next.title)}</b></a>` : ""
  }</nav>`;

  const codePill = entry.code && entry.code !== "00"
    ? `<button class="pill code" data-copy="${attr(entry.code)}" title="点击复制 prefab 代号">${esc(entry.code)}</button>`
    : `<span class="pill code">#${entry.id}</span>`;

  const body = `<main id="main" class="wrap doc">
<nav class="crumb">
  <a href="${rel}index.html">图鉴</a><span class="sep">/</span>
  <a href="${rel}c/${cat.slug}.html">${esc(cat.name)}</a><span class="sep">/</span>
  <span>${esc(entry.title)}</span>
</nav>
<section class="entry-hero">
  <div class="entry-icon">${entry.image ? `<img src="${rel}${entry.image}" alt="${attr(entry.title)}">` : ""}</div>
  <div class="entry-head">
    <h1>${esc(entry.title)}</h1>
    <div class="meta">
      <a class="pill gold" href="${rel}c/${cat.slug}.html">${esc(cat.name)}</a>
      ${codePill}
    </div>
  </div>
</section>
<div class="panel prose">${html}</div>
${related}
${pager}
</main>`;

  return layout({
    rel,
    page: "entry",
    title: entry.title,
    description: entry.excerpt.slice(0, 120),
    og: { image: entry.image || "" },
    body,
  });
}

/* ============================ 分类页 ============================ */
export function categoryPage(cat, data) {
  const rel = "../";
  const list = data.entriesByCat[cat.slug] || [];
  const cards = list.map((e, i) => card(e, rel, i)).join("\n");
  const body = `<main id="main">
<section class="hero wrap" style="padding:52px 0 18px">
  <div class="hero-rune">分类</div>
  <h1>${esc(cat.name)}</h1>
  <p class="sub">共 <b>${list.length}</b> 个词条</p>
  <div class="hero-search">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
    <input id="hero-search-input" type="search" placeholder="在「${attr(cat.name)}」中搜索…" aria-label="搜索" autocomplete="off">
  </div>
</section>
<div class="wrap">
  <nav class="crumb" style="padding:0 0 6px"><a href="${rel}index.html">图鉴</a><span class="sep">/</span><span>${esc(cat.name)}</span></nav>
  <div class="grid" id="grid">${cards}</div>
  <div class="empty" id="empty" hidden><b>没有找到相关词条</b>换个关键词试试。</div>
</div>
</main>`;
  return layout({ rel, page: "category", title: cat.name, description: `${cat.name}分类，共 ${list.length} 个词条。`, body });
}

/* ============================ 关于页 ============================ */
export function aboutPage(data) {
  const rel = "";
  const cats = data.categories
    .map((c) => `<a class="chip" href="c/${c.slug}.html">${esc(c.name)} <i>${c.count}</i></a>`)
    .join("");
  const body = `<main id="main" class="wrap doc">
<div class="hero" style="text-align:left;padding:60px 0 10px;max-width:760px">
  <div class="hero-rune">关于本站</div>
  <h1 style="font-size:clamp(34px,5vw,54px)">万物书 · 幻想图鉴</h1>
  <p class="sub" style="margin-left:0">一个为饥荒联机版模组《${CONFIG.name}》而建的玩家资料站，把散落的词条整理成一本可以随时翻阅的图鉴。</p>
</div>

<h2>这是什么</h2>
<p>本站收录《${CONFIG.name}》模组中的全部 <b>${data.entries.length}</b> 个词条，涵盖 ${data.categories.length} 个分类。每条词条都包含图标、分类、prefab 代号、正文说明与关联物品，支持全文搜索与分类筛选。</p>

<div class="info-grid">
  <div class="info-card"><h3>词条总数</h3><p>${data.entries.length}</p></div>
  <div class="info-card"><h3>分类</h3><p>${data.categories.length}</p></div>
  <div class="info-card"><h3>图片</h3><p>${data.entries.filter((e) => e.image).length} 张</p></div>
  <div class="info-card"><h3>数据更新</h3><p>${(data.meta.scrapedAt || "").slice(0, 10)}</p></div>
</div>

<h2>分类总览</h2>
<div class="chips">${cats}</div>

<h2>数据来源与声明</h2>
<ul>
  <li>词条数据来自公开接口 <a href="${CONFIG.sourceUrl}" target="_blank" rel="noopener">wiki.alan.plus</a>，本站仅做整理与展示。</li>
  <li>本站为玩家自制的非官方资料站，模组版权归原作者所有。</li>
  <li>若内容有误或希望补充，欢迎在 <a href="${CONFIG.repoUrl}" target="_blank" rel="noopener">GitHub</a> 提交 Issue / PR。</li>
</ul>

<h2>技术说明</h2>
<p>纯静态站点，构建脚本零第三方依赖；数据由 Node 脚本抓取快照，因此即使上游站点调整，本站也能稳定访问。图片已本地化，不再依赖源站。</p>
</main>`;
  return layout({ rel, page: "about", active: "about", title: "关于本站", description: "关于万物书图鉴资料站与数据来源。", body });
}

/* ============================ 编辑后台 ============================ */
export function adminPage() {
  return adminHtml({
    title: `编辑后台 · ${CONFIG.name}`,
    base: "../",
    cfg: {
      mode: "github",
      repo: CONFIG.repo,
      admins: CONFIG.admins,
      oauthClientId: CONFIG.oauthClientId,
      dataPath: CONFIG.dataPath,
      imagesPath: CONFIG.imagesPath,
    },
  });
}

/* ============================ 404 ============================ */
export function notFoundPage() {
  const base = CONFIG.siteUrl ? new URL(CONFIG.siteUrl).pathname.replace(/\/?$/, "/") : "./";
  const body = `<main id="main" class="wrap doc">
<div class="hero">
  <div class="hero-rune">404</div>
  <h1>这一页不在万物书中</h1>
  <p class="sub">你寻找的词条或许还未被记载，回到图鉴继续翻阅吧。</p>
  <p style="margin-top:26px"><a class="pill gold" href="${base}">返回图鉴</a></p>
</div>
</main>`;
  return layout({ rel: base, page: "404", title: "页面未找到", body });
}

/* ============================ 构建主流程 ============================ */
async function main() {
  const data = JSON.parse(await readFile(DATA, "utf8"));
  data.categories = buildCategories(data.entries, data.categories || []);
  data.entriesByCat = {};
  const slugOf = new Map(data.categories.map((c) => [c.name, c.slug]));
  for (const e of data.entries) {
    e.categorySlug = slugOf.get(e.category) || catSlug(e.category);
    (data.entriesByCat[e.categorySlug] ||= []).push(e);
  }
  const catByName = new Map(data.categories.map((c) => [c.slug, c]));

  await rm(DIST, { recursive: true, force: true });
  await mkdir(join(DIST, "e"), { recursive: true });
  await mkdir(join(DIST, "c"), { recursive: true });
  await mkdir(join(DIST, "admin"), { recursive: true });
  await mkdir(join(DIST, "assets"), { recursive: true });

  // 静态资源
  for (const f of ["styles.css", "app.js", "logo.svg", "admin.css", "admin.js"]) await cp(join(SRC, f), join(DIST, "assets", f));
  await cp(join(SRC, "images"), join(DIST, "images"), { recursive: true });
  await writeFile(join(DIST, ".nojekyll"), "");

  // 页面
  await writeFile(join(DIST, "index.html"), homePage(data));
  await writeFile(join(DIST, "about.html"), aboutPage(data));
  await writeFile(join(DIST, "404.html"), notFoundPage());
  await writeFile(join(DIST, "admin", "index.html"), adminPage());
  for (const e of data.entries) {
    await writeFile(join(DIST, "e", `${e.slug}.html`), entryPage(e, catByName.get(e.categorySlug), data));
  }
  for (const c of data.categories) {
    await writeFile(join(DIST, "c", `${c.slug}.html`), categoryPage(c, data));
  }

  // SEO
  await writeFile(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /admin/\n${CONFIG.siteUrl ? `Sitemap: ${CONFIG.siteUrl.replace(/\/?$/, "/")}sitemap.xml\n` : ""}`);
  if (CONFIG.siteUrl) {
    const base = CONFIG.siteUrl.replace(/\/?$/, "/");
    const urls = ["", "about.html", ...data.entries.map((e) => `e/${e.slug}.html`), ...data.categories.map((c) => `c/${c.slug}.html`)];
    const today = new Date().toISOString().slice(0, 10);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${base}${u}</loc><lastmod>${today}</lastmod></url>`)
      .join("\n")}\n</urlset>\n`;
    await writeFile(join(DIST, "sitemap.xml"), xml);
  }

  console.log(`✓ 构建完成：${data.entries.length} 词条页 / ${data.categories.length} 分类页 / 编辑后台 -> dist/admin/`);
  console.log(`  输出目录 -> ${DIST}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
