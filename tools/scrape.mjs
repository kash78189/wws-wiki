/**
 * 万物书 · 幻想图鉴 —— 数据抓取器
 * 数据源：https://wiki.alan.plus/api  (公开接口)
 *   GET /modlist/search?type=wws&limit=999&page=1   词条列表（含正文 HTML）
 *   GET /navlist?type=wws&limit=999&page=1          分类目录
 *
 * 产物：
 *   data/wws.json          归一化后的全部数据（供 build.mjs 使用）
 *   src/images/<hash>.<ext> 本地化的全部图片
 *
 * 零依赖：仅使用 Node 18+ 内置的 fetch / fs / crypto。
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://wiki.alan.plus/api";
const TYPE = "wws";
const IMG_DIR = join(ROOT, "src", "images");
const DATA_FILE = join(ROOT, "data", "wws.json");

const UA = "Mozilla/5.0 (compatible; wws-wiki-scraper/1.0; +https://github.com/)";

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

async function getJSON(url, tries = 4) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      last = err;
      await sleep(600 * i);
    }
  }
  throw new Error(`GET ${url} 失败：${last?.message}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
  "&apos;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–",
  "&hellip;": "…", "&times;": "×", "&middot;": "·",
};
function decodeEntities(s = "") {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

function stripTags(html = "") {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, " ")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** 归一化图片地址：相对路径补成绝对 URL */
function absImage(u) {
  if (!u) return null;
  const s = String(u).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://wiki.alan.plus/${s.replace(/^\/+/, "")}`;
}

/** 用 URL 内容生成稳定文件名，避免 uploads/ 与 images/ 同名冲突 */
function localImageName(url) {
  let ext = extname(new URL(url).pathname).toLowerCase();
  if (!/^\.(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(ext)) ext = ".png";
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 16);
  return `${hash}${ext}`;
}

/** 生成 URL slug：优先用 DST prefab code，非法或有重复时回退到 id */
function makeSlug(code, id, used, title) {
  let base = String(code ?? "").trim();
  const ok = /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(base) && !used.has(base);
  if (!ok) {
    base = `entry-${id}`;
  }
  used.add(base);
  return base;
}

/* ------------------------------------------------------------------ */
/* 正文 HTML 清洗                                                       */
/* ------------------------------------------------------------------ */

function cleanHtml(html, titleToSlug) {
  let out = String(html ?? "");

  // 1. 去掉危险标签
  out = out.replace(/<\/?(script|style|iframe|object|embed|link|meta|form|input)\b[^>]*>/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // 2. 把站内指引链接（href 为空 / class="keywords"）按锚文本还原成词条链接
  //    <a ...>锚文本</a> -> @@entry/slug@@ 占位，构建时再替换成相对路径
  out = out.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (m, attrs, inner) => {
    const label = stripTags(inner).trim();
    const slug = titleToSlug.get(label);
    if (!slug) return inner; // 无对应词条：退化成纯文本，避免死链
    return `<a class="ilink" data-entry="${slug}" href="@@entry/${slug}@@">${inner}</a>`;
  });

  // 3. 清理空段落里的多余换行
  out = out.replace(/(<p>\s*(<br\s*\/?>)?\s*<\/p>\s*)+/gi, "");

  return out.trim();
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("→ 拉取词条列表 …");
  const listRes = await getJSON(`${API}/modlist/search?type=${TYPE}&limit=999&page=1`);
  if (!listRes.success) throw new Error("接口返回失败：" + JSON.stringify(listRes).slice(0, 200));
  const rawItems = listRes.data?.data ?? listRes.data ?? [];
  console.log(`  得到 ${rawItems.length} 个词条`);

  console.log("→ 拉取分类目录 …");
  let navItems = [];
  try {
    const navRes = await getJSON(`${API}/navlist?type=${TYPE}&limit=999&page=1`);
    navItems = navRes.data?.data ?? [];
  } catch (e) {
    console.warn("  分类接口失败，改用词条 mode 推断：", e.message);
  }

  /* --- slug 与标题索引 --- */
  const used = new Set();
  const records = rawItems.map((it) => {
    const slug = makeSlug(it.code, it.id, used, it.title);
    return {
      id: it.id,
      slug,
      title: decodeEntities(String(it.title ?? "").trim()),
      code: String(it.code ?? "").trim(),
      category: decodeEntities(String(it.mode ?? "未分类").trim()) || "未分类",
      level: Number.isFinite(it.level) ? it.level : 0,
      rawImage: absImage(it.img),
      rawKeywords: Array.isArray(it.keywords) ? it.keywords : [],
      rawHtml: it.main ?? "",
      createdAt: it.created_at ?? null,
    };
  });

  const titleToSlug = new Map();
  for (const r of records) {
    if (!titleToSlug.has(r.title)) titleToSlug.set(r.title, r.slug);
  }

  /* --- 图片收集与下载 --- */
  const imageQueue = new Map(); // 原始URL -> 本地文件名
  for (const r of records) {
    if (r.rawImage) imageQueue.set(r.rawImage, localImageName(r.rawImage));
    for (const k of r.rawKeywords) {
      const u = absImage(k?.img);
      if (u) imageQueue.set(u, localImageName(u));
    }
  }
  console.log(`→ 需要下载 ${imageQueue.size} 张图片 …`);
  await mkdir(IMG_DIR, { recursive: true });

  const entries = [...imageQueue.entries()];
  let done = 0, skipped = 0, failed = 0;
  const CONC = 8;
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (entries.length) {
        const [url, name] = entries.shift();
        const dest = join(IMG_DIR, name);
        try {
          await access(dest);
          skipped++;
        } catch {
          try {
            const res = await fetch(url, { headers: { "user-agent": UA } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            await writeFile(dest, buf);
          } catch (e) {
            failed++;
            console.warn(`  ! ${url} -> ${e.message}`);
          }
        }
        if (++done % 50 === 0 || done === imageQueue.size) {
          process.stdout.write(`\r  图片进度 ${done}/${imageQueue.size}（缓存 ${skipped}，失败 ${failed}）`);
        }
      }
    })
  );
  process.stdout.write("\n");

  /* --- 归一化正文与关联词条 --- */
  for (const r of records) {
    r.image = r.rawImage ? `images/${imageQueue.get(r.rawImage)}` : null;
    r.html = cleanHtml(r.rawHtml, titleToSlug);
    r.excerpt = stripTags(r.rawHtml).slice(0, 90);
    r.keywords = r.rawKeywords
      .map((k) => {
        const title = decodeEntities(String(k?.title ?? "").trim());
        const u = absImage(k?.img);
        return {
          title,
          slug: titleToSlug.get(title) ?? null,
          image: u ? `images/${imageQueue.get(u)}` : null,
        };
      })
      .filter((k) => k.title);
    delete r.rawImage;
    delete r.rawKeywords;
    delete r.rawHtml;
  }

  /* --- 分类排序：优先按 navlist，其次按 level / 词条数 --- */
  const navOrder = new Map(navItems.map((n, i) => [n.name, { order: i, level: n.level }]));
  const counts = new Map();
  for (const r of records) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const categories = [...counts.keys()]
    .map((name) => ({
      name,
      slug: "cat-" + createHash("md5").update(name).digest("hex").slice(0, 8),
      count: counts.get(name),
      level: navOrder.get(name)?.level ?? 0,
      order: navOrder.get(name)?.order ?? 999,
    }))
    .sort((a, b) => a.order - b.order || b.level - a.level || b.count - a.count);

  const output = {
    meta: {
      mod: "万物书",
      type: TYPE,
      source: `https://wiki.alan.plus/#/?type=${TYPE}`,
      api: API,
      scrapedAt: new Date().toISOString(),
      total: records.length,
    },
    categories,
    entries: records,
  };

  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(output, null, 1), "utf8");
  console.log(`✓ 完成：${records.length} 词条 / ${categories.length} 分类 / ${imageQueue.size} 图片`);
  console.log(`  数据 -> ${DATA_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
