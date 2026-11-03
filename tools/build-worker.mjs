/**
 * 生成 Cloudflare Worker 的后台前端资源 -> worker/public/
 * 由 npm run worker:dev / worker:deploy 自动调用
 */
import { mkdir, writeFile, cp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { adminHtml } from "./admin-html.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "worker", "public");

const owner = process.env.GH_OWNER || "kash78189";
const name = process.env.GH_REPO || "wws-wiki";
const branch = process.env.GH_BRANCH || "main";

await mkdir(join(OUT, "assets"), { recursive: true });
await mkdir(join(OUT, "admin"), { recursive: true });

for (const f of ["styles.css", "admin.css", "admin.js", "logo.svg", "app.js"]) {
  await cp(join(SRC, f), join(OUT, "assets", f));
}

await writeFile(
  join(OUT, "admin", "index.html"),
  adminHtml({
    title: "编辑后台 · 万物书",
    base: "/",
    cfg: {
      mode: "worker",
      apiBase: "",
      repo: { owner, name, branch },
      dataPath: "data/wws.json",
      imagesPath: "src/images",
    },
  })
);

// 根路径兜底（正常情况下 Worker 会把 / 重定向到 /admin/）
await writeFile(
  join(OUT, "index.html"),
  `<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/admin/"><title>万物书 · 编辑后台</title>`
);

console.log(`✓ Worker 前端已生成 -> worker/public/（${owner}/${name}@${branch}）`);
