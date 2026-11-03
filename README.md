# 万物书 · 幻想图鉴

饥荒联机版模组《万物书》的玩家资料站。收录 **307 个词条**、**12 个分类**、**299 张图标**，支持全文搜索、分类筛选与关联跳转。

- 纯静态站点，构建脚本**零第三方依赖**（仅用 Node 内置能力）
- 数据来自公开接口 `wiki.alan.plus`，抓取后**本地快照 + 图片本地化**，不依赖源站可用性
- 相对路径输出，可直接部署到 GitHub Pages（含子路径）

---

## 快速开始

```bash
# 1. 抓取数据（可选，仓库内已含快照）
node tools/scrape.mjs

# 2. 生成静态站点到 dist/
node tools/build.mjs

# 3. 本地预览
npx serve dist          # 或任意静态服务器
```

---

## 目录结构

```
.
├─ data/wws.json          # 归一化后的全部词条数据（构建输入）
├─ tools/
│  ├─ scrape.mjs          # 抓取器：拉取接口 + 下载图片 + 清洗正文
│  └─ build.mjs           # 生成器：产出 dist/ 静态站点
├─ src/
│  ├─ styles.css          # 站点样式（设计稿即此文件）
│  ├─ app.js              # 搜索 / 筛选 / 排序 / 主题切换
│  ├─ logo.svg            # 站点图标
│  └─ images/             # 本地化图片（抓取产物）
├─ dist/                  # 构建产物（不提交，由 CI 生成）
└─ .github/workflows/deploy.yml
```

---

## 数据来源

| 项目 | 值 |
| --- | --- |
| 站点 | https://wiki.alan.plus/#/?type=wws |
| 词条接口 | `GET /api/modlist/search?type=wws&limit=999&page=1` |
| 分类接口 | `GET /api/navlist?type=wws&limit=999&page=1` |

抓取器会：

1. 拉取全部词条（含正文 HTML）与分类目录；
2. 下载词条图标与关联缩略图到 `src/images/`（用 URL 哈希命名，避免同名冲突）；
3. 清洗正文：移除脚本/事件属性，把源站的空链接按锚文本还原为站内词条链接；
4. 输出 `data/wws.json`。

> 更新数据：只要重新运行 `node tools/scrape.mjs && node tools/build.mjs` 即可。

---

## 部署到 GitHub Pages

1. 新建仓库并推送本目录：

   ```bash
   git init
   git add .
   git commit -m "chore: 万物书图鉴"
   git branch -M main
   git remote add origin https://github.com/<用户名>/<仓库名>.git
   git push -u origin main
   ```

2. 打开仓库 **Settings → Pages**，将 **Source** 设为 **GitHub Actions**。

3. 推送后 `Deploy to GitHub Pages` 工作流会自动构建并发布。
   地址为 `https://<用户名>.github.io/<仓库名>/`。

> 工作流会用仓库信息自动推导 `SITE_URL`（用于 sitemap / 404），无需手动配置。
> 若绑定了自定义域名，可在 workflow 或本地用环境变量覆盖：
> `SITE_URL=https://your-domain.com REPO_URL=https://github.com/you/repo node tools/build.mjs`

---

## 自定义

| 想改什么 | 改哪里 |
| --- | --- |
| 站点名称 / 副标题 / 工坊链接 | `tools/build.mjs` 顶部的 `CONFIG` |
| 配色 / 字体 / 布局 | `src/styles.css` 顶部 CSS 变量与各区块 |
| 搜索、筛选、排序行为 | `src/app.js` |
| 抓取范围 / 清洗规则 | `tools/scrape.mjs` |

---

## 声明

本站为玩家自制的非官方资料站，模组版权归原作者所有；词条内容整理自公开接口，仅用于玩家查阅。
