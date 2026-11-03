/**
 * 后台页面骨架 —— 静态站（GitHub 模式）与 Cloudflare Worker（账号密码模式）共用
 */
export function adminHtml({ title = "编辑后台", base = "../", cfg = {} } = {}) {
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="dark light">
<link rel="icon" type="image/svg+xml" href="${base}assets/logo.svg">
<link rel="stylesheet" href="${base}assets/styles.css">
<link rel="stylesheet" href="${base}assets/admin.css">
</head>
<body class="admin">
<main id="main" hidden></main>
<script>window.__WWS_ADMIN__=${json};</script>
<script src="${base}assets/admin.js" defer></script>
</body>
</html>`;
}
