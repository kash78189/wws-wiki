# 编辑后台后端 · Cloudflare Worker

给《万物书》图鉴用的**账号密码登录 + 写入 GitHub** 后台服务，外层再加一道 **Cloudflare Access 网关**。

```
        ┌──────────── 公网访客 ────────────┐
        │                                  │
        ▼                                  ▼
 GitHub Pages（图鉴，只读）        Cloudflare Access 网关
 https://kash78189.github.io/wws-wiki/    │  邮箱 OTP，只有管理员邮箱能过
                                          ▼
                                 Cloudflare Worker（本目录）
                                  · 托管 /admin/ 前端（同源）
                                  · /api/login 账号密码 → 签名会话令牌
                                  · /api/data  读写词条数据
                                  · /api/upload 上传图片
                                          │  GitHub Contents API
                                          ▼
                                  kash78189/wws-wiki 仓库
                                          │  push 触发
                                          ▼
                                  GitHub Actions 重建 → Pages 上线
```

**两层防护**：Access 挡掉所有非管理员邮箱 → 进来之后还要过账号密码。

---

## 一、部署 Worker

### 0. 前置

- 一个 Cloudflare 账号（免费版即可）
- Node 18+

### 1. 安装 wrangler 并登录

```bash
npm i -D wrangler        # 或在项目根目录 npx wrangler
npx wrangler login
```

### 2. 生成管理员账号

```bash
node tools/passwd.mjs kash "你的密码"
# → {"kash":{"salt":"...","hash":"...","iterations":150000}}
```

多个管理员就把 JSON 合并成一个对象：

```bash
node -e "
const a=require('fs').existsSync('admins.json')?JSON.parse(require('fs').readFileSync('admins.json')):{};
Object.assign(a, JSON.parse(process.argv[1]));
console.log(JSON.stringify(a));
" '{"lisi":{"salt":"...","hash":"..."}}'
```

> 改密码 = 重新生成该用户的条目，再重设一次 `ADMIN_USERS` 机密。

### 3. 设置三个机密

```bash
cd worker

# ① 能写 kash78189/wws-wiki 的 GitHub 令牌（fine-grained，Contents: Read and write）
npx wrangler secret put GITHUB_TOKEN

# ② 会话签名密钥，随便一串长随机字符
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" | npx wrangler secret put SESSION_SECRET

# ③ 第 2 步生成的 JSON
npx wrangler secret put ADMIN_USERS
```

### 4. 部署

```bash
# 在项目根目录
npm run worker:deploy        # 会先跑 tools/build-worker.mjs 生成前端资源
```

部署完会打印一个地址，形如 `https://wws-admin.<你的子域>.workers.dev`。
打开它 → 会跳到 `/admin/` → 看到登录页。

### 本地调试

```bash
cd worker
cat > .dev.vars <<'EOF'
GITHUB_TOKEN=ghp_xxx
SESSION_SECRET=dev-secret
ADMIN_USERS={"kash":{"salt":"...","hash":"...","iterations":150000}}
EOF
npx wrangler dev        # http://localhost:8787
```

---

## 二、接上 Cloudflare Access 网关

> 免费版 Zero Trust 支持最多 50 个用户，够用。

1. 打开 **Cloudflare Dashboard → Zero Trust**（首次进入会让你取一个 team name，随便填）
2. 左侧 **Access → Applications → Add an application → Self-hosted**
3. 填写：

   | 字段 | 值 |
   | --- | --- |
   | Application name | `万物书编辑后台` |
   | Session Duration | `24 hours` |
   | Application domain | `wws-admin.<你的子域>.workers.dev`（就是你上一步部署出来的域名） |
   | Path | 留空（保护整个域名） |

4. **Add policy**：
   - Policy name：`管理员`
   - Action：`Allow`
   - Configure rules → **Include** → Selector 选 `Emails` → 填入你们几个管理员的邮箱（邮箱会收到一次性验证码）

5. 保存。之后访问该域名会先跳到 Cloudflare 的邮箱验证页，**非白名单邮箱根本看不到登录框**。

> 想让流程更顺手：把 Access 的 **Login methods** 里加上 Google/GitHub 等 IdP（Zero Trust → Settings → Authentication），以后一键登录。
>
> 想让地址好看：给这个 Worker 绑一个自定义域名（`wrangler.toml` 里加 `routes`），再用 Access 保护那个域名。

### 验证网关是否生效

```bash
curl -sI https://wws-admin.<你的子域>.workers.dev/api/health | head -3
# 期望：302 跳到 https://<team>.cloudflareaccess.com/cdn-cgi/access/login/...
# 出现这条跳转 = 网关已经在拦人了
```

---

## 三、接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（不需要登录，方便探活） |
| POST | `/api/login` | `{user,password}` → `{token,user}` |
| GET | `/api/me` | 校验会话，返回 `{user}` |
| POST | `/api/logout` | 登出（客户端丢弃令牌） |
| GET | `/api/data` | 读取 `data/wws.json` → `{sha,data}` |
| PUT | `/api/data` | `{sha,data,message}` → `{sha,commit}`；sha 过期返回 `409` |
| PUT | `/api/upload` | `{name,content(base64)}` → `{path}` |

鉴权：除 `/api/health` 和 `/api/login` 外，都要 `Authorization: Bearer <token>`。
令牌是 HMAC-SHA256 签名的无状态令牌，有效期 12 小时，服务端不存任何会话。

## 四、自测

```bash
node worker/test/local-test.mjs
# 20 项断言：未登录拦截、错误密码、令牌签发、读写代理、非法文件名、409 冲突、CORS 白名单、路由
```

## 五、安全说明

- 密码用 **PBKDF2-SHA256 / 150000 次迭代**加盐存储，绝不明文落库
- 登录失败固定延迟 700ms，拖慢暴力破解
- GitHub 令牌只存在 Worker 机密里，浏览器永远拿不到
- 会话令牌无状态、服务端无法吊销 —— 所以有效期设为 12 小时，改密码后旧令牌最多还能用 12 小时（要立刻失效就把 `SESSION_SECRET` 换掉）
- Worker 的 `ALLOWED_ORIGINS` 只放行你自己的站点域名，避免被第三方网页调用 API
