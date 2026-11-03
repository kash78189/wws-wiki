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
│  ├─ admin.css           # 编辑后台样式
│  ├─ admin.js            # 编辑后台逻辑（GitHub 后端）
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

## 编辑后台（仅管理员）

地址：`https://<用户名>.github.io/<仓库名>/admin/`（页脚也有一个不显眼的「管理」入口）

**设计思路**：站点是纯静态的（没有服务器），所以直接把 **GitHub 仓库当作数据库**。
管理员在网页上编辑 → 后台用 GitHub API 提交一次 commit → GitHub Actions 自动重新构建并发布（约 1 分钟）。
好处：不用另外买服务器、数据有完整版本历史、可以随时回滚。

### 谁能登录

登录需要满足两个条件（**由 GitHub 自己把关**，不靠本站）：

1. 持有一个 **Fine-grained Personal Access Token**，勾选了本仓库的 `Contents: Read and write`
2. 该账号是**本仓库的协作者**（有写权限）

所以「只有我们几个能用」是天然成立的：不在仓库里给写权限，就无法登录。

> 邀请管理员：仓库 **Settings → Collaborators → Add people**。

### 管理员怎么登录

1. 打开 [创建 token](https://github.com/settings/tokens?type=beta) → **Generate new token (fine-grained)**
2. **Repository access** 选 *Only select repositories* → 选中本站仓库
3. **Permissions → Repository permissions → Contents** 选 **Read and write**
4. 生成后复制，粘贴到后台登录框即可

Token 只存在管理员自己的浏览器（localStorage），不会经过任何第三方服务器。

### 能做什么

- 搜索 / 筛选词条列表，即时编辑标题、分类、prefab 代号、排序、日期
- 富文本正文编辑 + 实时预览，一键由正文生成摘要
- 上传/更换词条图标（自动命名、提交到仓库）
- 维护「关联词条」
- 新增 / 删除词条
- 每次「保存并发布」= 一次 commit，CI 自动重新部署

### 可选的额外配置（仓库 Settings → Secrets and variables → Actions → Variables）

| 变量名 | 作用 |
| --- | --- |
| `GH_ADMINS` | 逗号分隔的 GitHub 用户名白名单。**留空则以仓库写权限为准**（推荐留空） |
| `GH_OAUTH_CLIENT_ID` | 填入 GitHub OAuth App 的 client_id 后，登录页会多出「使用 GitHub 账号登录」（设备码授权，无需服务器） |

> 设备码登录需要先到 GitHub **Settings → Developer settings → OAuth Apps** 新建一个应用（Homepage 填站点地址，不用填 callback），拿到 client_id 填进上面的变量。

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
