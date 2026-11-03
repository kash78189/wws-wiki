/* 万物书 · 编辑后台（GitHub 作为后端） */
(() => {
  "use strict";
  const CFG = window.__WWS_ADMIN__ || {};
  const OWNER = CFG.repo && CFG.repo.owner;
  const NAME = CFG.repo && CFG.repo.name;
  const BRANCH = (CFG.repo && CFG.repo.branch) || "main";
  const DATA = CFG.dataPath || "data/wws.json";
  const IMGDIR = CFG.imagesPath || "src/images";
  const API = "https://api.github.com";
  const MODE = CFG.mode === "worker" ? "worker" : "github";
  const API_BASE = (CFG.apiBase || "").replace(/\/+$/, "");
  const LS = MODE === "worker" ? "wws.admin.session" : "wws.admin.token";
  const $ = (s, r = document) => r.querySelector(s);

  let token = "";
  let user = null;
  let data = null;
  let sha = null;
  let current = null;
  let dirty = false;
  let previewHTML = null;

  /* ---------- 工具 ---------- */
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b) {
    const bin = atob(String(b).replace(/\s/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
  function fnv(name) {
    let x = 0x811c9dc5;
    for (let i = 0; i < name.length; i++) { x ^= name.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return "cat-" + (x >>> 0).toString(16).padStart(8, "0");
  }
  const plain = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

  /* ---------- GitHub API ---------- */
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
      method: opts.method || "GET",
      headers: Object.assign({
        Accept: "application/vnd.github+json",
        Authorization: "token " + token,
        "X-GitHub-Api-Version": "2022-11-28"
      }, opts.headers || {}),
      body: opts.body
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* ignore */ }
    if (!res.ok) {
      const err = new Error((json && json.message) || res.status + " " + res.statusText);
      err.status = res.status; err.json = json;
      throw err;
    }
    return json;
  }
  const repoPath = (p) => `/repos/${OWNER}/${NAME}/contents/${p}`;

  /* ---------- 后台服务（Cloudflare Worker） ---------- */
  async function wfetch(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers: Object.assign({ "content-type": "application/json" },
        opts.auth === false || !token ? {} : { authorization: "Bearer " + token }),
      body: opts.body
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* ignore */ }
    if (!res.ok) {
      const err = new Error((json && (json.error || json.message)) || res.status + " " + res.statusText);
      err.status = res.status; err.json = json;
      throw err;
    }
    return json;
  }

  /** 图片按内容 SHA-1 命名，抓取器 / 后台保持一致 */
  async function imageName(file, buf) {
    const hash = hex(await crypto.subtle.digest("SHA-1", buf)).slice(0, 20);
    const ext = /\.svg$/i.test(file.name) ? ".svg" : /\.png$/i.test(file.name) ? ".png" : /\.webp$/i.test(file.name) ? ".webp" : ".jpg";
    return hash + ext;
  }
  function binOf(buf) {
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return bin;
  }

  async function authenticate(cred) {
    if (MODE === "worker") {
      const r = await wfetch("/api/login", { method: "POST", auth: false, body: JSON.stringify(cred) });
      token = r.token;
      user = { login: r.user, avatar_url: "" };
      localStorage.setItem(LS, token);
      return true;
    }
    const tmp = token; token = cred;
    try {
      const u = await gh("/user");
      const r = await gh(`/repos/${OWNER}/${NAME}`);
      const push = !!(r.permissions && r.permissions.push);
      if (!push) throw new Error("该账号对仓库没有写权限，无法编辑");
      const allow = CFG.admins || [];
      if (allow.length && !allow.includes(u.login)) throw new Error("该账号不在管理员名单中：" + u.login);
      user = u;
      localStorage.setItem(LS, cred);
      return true;
    } catch (e) { token = tmp; throw e; }
  }

  /** 用本地保存的凭据恢复会话 */
  async function restore() {
    if (MODE === "worker") {
      const r = await wfetch("/api/me");
      user = { login: r.user, avatar_url: "" };
      return true;
    }
    return authenticate(token);
  }

  function logout() {
    if (MODE === "worker" && token) { try { wfetch("/api/logout", { method: "POST" }).catch(() => {}); } catch (e) { /* ignore */ } }
    localStorage.removeItem(LS);
    token = ""; user = null; data = null; sha = null; current = null;
    renderLogin();
  }

  /* ---------- 文件读写 ---------- */
  async function loadData() {
    if (MODE === "worker") {
      const r = await wfetch("/api/data");
      sha = r.sha;
      data = r.data;
    } else {
      const res = await gh(repoPath(DATA) + "?ref=" + BRANCH);
      sha = res.sha;
      data = JSON.parse(b64decode(res.content));
    }
    data.entries.sort((a, b) => a.id - b.id);
  }
  async function saveData(message) {
    const msg = message || "chore(admin): 更新词条数据";
    let url = null;
    if (MODE === "worker") {
      const r = await wfetch("/api/data", { method: "PUT", body: JSON.stringify({ sha, data, message: msg }) });
      sha = r.sha;
      url = r.commit || null;
    } else {
      const body = JSON.stringify({ message: msg, content: b64encode(JSON.stringify(data, null, 1)), sha, branch: BRANCH });
      const res = await gh(repoPath(DATA), { method: "PUT", body });
      sha = res.content.sha;
      url = res.commit && res.commit.html_url;
    }
    dirty = false;
    return url;
  }
  async function uploadImage(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const name = await imageName(file, buf);
    if (MODE === "worker") {
      const r = await wfetch("/api/upload", { method: "PUT", body: JSON.stringify({ name, content: btoa(binOf(buf)) }) });
      return r.path;
    }
    await gh(repoPath(IMGDIR + "/" + name), {
      method: "PUT",
      body: JSON.stringify({ message: "chore(admin): 上传图片 " + name, content: btoa(binOf(buf)), branch: BRANCH })
    });
    return "images/" + name;
  }

  /* ---------- 登录界面 ---------- */
  function renderLogin(msg, kind) {
    const isWorker = MODE === "worker";
    const card = h("div", { class: "login-card" },
      h("div", { class: "rune", html: '<svg viewBox="0 0 64 64" fill="none"><path d="M32 6c-7 0-12 5-12 12v4h-4a4 4 0 0 0-4 4v26a4 4 0 0 0 4 4h32a4 4 0 0 0 4-4V26a4 4 0 0 0-4-4h-4v-4c0-7-5-12-12-12Zm0 6c4 0 6 3 6 6v4H26v-4c0-3 2-6 6-6Z" stroke="#e9b872" stroke-width="2.4" stroke-linejoin="round"/><circle cx="32" cy="38" r="4" fill="#e9b872"/></svg>' }),
      h("h1", null, "编辑后台"),
      h("p", { class: "sub" }, "仅限《万物书》图鉴管理员使用。普通访客无需登录，可自由浏览全部内容。"),
      msg ? h("div", { class: "alert " + (kind || "err") }, msg) : null,
      isWorker
        ? h("div", null,
            h("div", { class: "field" }, h("label", null, "用户名"), h("input", { type: "text", id: "un", autocomplete: "username", spellcheck: "false" })),
            h("div", { class: "field" }, h("label", null, "密码"), h("input", { type: "password", id: "pw", autocomplete: "current-password" }))
          )
        : h("div", null,
            h("div", { class: "field" }, h("label", null, "GitHub 访问令牌 (Token)"), h("input", { type: "password", id: "tk", placeholder: "github_pat_… 或 ghp_…", autocomplete: "off", spellcheck: "false" })),
            h("p", { class: "hintline", html: '需要一个 <b>Fine-grained token</b>，权限勾选本仓库的 <code>Contents: Read and write</code>。<a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener">点此创建 →</a>' })
          ),
      h("button", { class: "btn primary block", id: "go" }, isWorker ? "登录" : "验证并登录"),
      !isWorker && CFG.oauthClientId ? h("button", { class: "btn block", id: "dev", style: "margin-top:10px" }, "使用 GitHub 账号登录") : null,
      h("p", { class: "hintline", style: "text-align:center;margin-top:18px" }, isWorker
        ? "账号由站长分配；登录状态仅保存在你自己的浏览器中。"
        : "令牌仅保存在你自己的浏览器中，不会上传到任何服务器。")
    );
    const wrap = h("div", { class: "login-wrap" }, card);
    document.body.replaceChildren(topbar(), wrap);
    const first = $("#" + (isWorker ? "un" : "tk"), wrap);
    const submit = async () => {
      const btn = $("#go", wrap); btn.disabled = true; btn.textContent = isWorker ? "登录中…" : "验证中…";
      try {
        if (isWorker) {
          const u = $("#un", wrap).value.trim(), p = $("#pw", wrap).value;
          if (!u || !p) throw new Error("请输入用户名和密码");
          await authenticate({ user: u, password: p });
        } else {
          const tk = $("#tk", wrap).value.trim();
          if (!tk) throw new Error("请输入令牌");
          await authenticate(tk);
        }
        await boot();
      } catch (e) { renderLogin(e.message, "err"); }
    };
    $("#go", wrap).addEventListener("click", submit);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    if (!isWorker && CFG.oauthClientId) $("#dev", wrap).addEventListener("click", deviceFlow);
    first.focus();
  }

  async function deviceFlow() {
    try {
      const r1 = await fetch("https://github.com/login/device/code", {
        method: "POST", headers: { Accept: "application/json" },
        body: new URLSearchParams({ client_id: CFG.oauthClientId, scope: "public_repo" })
      });
      const d = await r1.json();
      const card = $(".login-card");
      card.replaceChildren(
        h("h1", null, "设备授权"),
        h("p", { class: "sub", html: '请在浏览器打开 <a href="' + d.verification_uri + '" target="_blank" rel="noopener" style="color:var(--gold)">' + d.verification_uri + "</a> 并输入下方代码：" }),
        h("div", { style: "font-family:var(--font-mono);font-size:30px;letter-spacing:.18em;text-align:center;padding:16px;border:1px dashed var(--gold-dim);border-radius:12px;margin-bottom:18px" }, d.user_code),
        h("div", { class: "alert info", id: "poll" }, "等待授权…"),
        h("button", { class: "btn ghost block", onclick: () => renderLogin() }, "返回")
      );
      const wait = (d.interval || 5) * 1000 + 500;
      const tick = async () => {
        const r2 = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST", headers: { Accept: "application/json" },
          body: new URLSearchParams({ client_id: CFG.oauthClientId, device_code: d.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" })
        });
        const t = await r2.json();
        if (t.access_token) { await authenticate(t.access_token); return boot(); }
        if (t.error === "authorization_pending" || t.error === "slow_down") { setTimeout(tick, wait); return; }
        renderLogin("授权失败：" + (t.error_description || t.error), "err");
      };
      setTimeout(tick, wait);
    } catch (e) { renderLogin(e.message, "err"); }
  }

  /* ---------- 顶栏 ---------- */
  function topbar() {
    return h("header", { class: "admin-top" },
      h("a", { class: "logo", href: "index.html", title: "返回图鉴" },
        h("span", { html: '<svg viewBox="0 0 32 32" fill="none"><path d="M6 5h13a5 5 0 0 1 5 5v17H11a5 5 0 0 1-5-5V5Z" stroke="currentColor" stroke-width="1.8"/><path d="M6 22c0-2.8 2.2-5 5-5h13" stroke="#e9b872" stroke-width="1.8"/></svg>' }),
        h("span", null, "万物书")
      ),
      h("span", { class: "repo" }, OWNER + "/" + NAME + " · " + BRANCH),
      h("div", { class: "spacer" }),
      user ? h("div", { class: "userchip" }, h("img", { src: user.avatar_url, alt: "" }), h("span", null, user.login)) : null,
      h("button", { class: "btn ghost", onclick: toggleTheme, title: "切换主题" }, "◐"),
      user ? h("button", { class: "btn ghost", onclick: logout }, "退出") : null
    );
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", cur);
    localStorage.setItem("wws.theme", cur);
  }

  /* ---------- 工作区 ---------- */
  let filter = { q: "", cat: "" };
  function render() {
    document.body.replaceChildren(topbar(), data ? workspace() : h("div", { class: "login-wrap" }, h("div", { class: "alert info" }, "加载中…")));
  }

  function workspace() {
    return h("div", { class: "admin-wrap" }, sidebar(), h("main", { class: "admin-editor" }));
  }

  function categories() {
    const set = new Map();
    data.entries.forEach((e) => set.set(e.category, (set.get(e.category) || 0) + 1));
    return [...set.entries()].sort((a, b) => b[1] - a[1]);
  }

  function sidebar() {
    const list = h("div", { class: "entry-list" });
    const q = h("input", { placeholder: "搜索标题 / 代号…", value: filter.q });
    const sel = h("select", null,
      h("option", { value: "" }, "全部分类"),
      ...categories().map(([n, c]) => h("option", { value: n, selected: filter.cat === n ? "selected" : null }, n + "（" + c + "）"))
    );
    const paint = () => {
      list.replaceChildren();
      const kw = filter.q.trim().toLowerCase();
      const items = data.entries.filter((e) =>
        (!filter.cat || e.category === filter.cat) &&
        (!kw || (e.title + " " + (e.code || "") + " " + e.slug).toLowerCase().includes(kw))
      );
      items.forEach((e) => list.appendChild(
        h("div", { class: "entry-item" + (current === e ? " active" : ""), onclick: () => select(e) },
          h("img", { src: e.image || "../assets/logo.svg", alt: "", loading: "lazy" }),
          h("div", { style: "min-width:0" }, h("div", { class: "t" }, e.title), h("div", { class: "c" }, e.code || "—"))
        )
      ));
      if (!items.length) list.appendChild(h("p", { class: "hintline", style: "padding:20px;text-align:center" }, "没有匹配的词条"));
    };
    q.addEventListener("input", () => { filter.q = q.value; paint(); });
    sel.addEventListener("change", () => { filter.cat = sel.value; paint(); });
    paint();
    return h("aside", { class: "admin-side" },
      h("div", { class: "side-tools" }, q, sel,
        h("button", { class: "btn", onclick: addEntry }, "＋ 新增词条")),
      list
    );
  }

  function select(e) {
    if (dirty && !confirm("当前修改尚未保存，确定切换吗？")) return;
    current = e; dirty = false; render();
  }
  function addEntry() {
    if (dirty && !confirm("当前修改尚未保存，确定新增吗？")) return;
    const id = data.entries.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    const e = {
      id, slug: "entry-" + id, title: "新词条", code: "", category: categories()[0] ? categories()[0][0] : "幻想道具",
      level: (data.entries.reduce((m, x) => Math.max(m, x.level || 0), 0) + 1), createdAt: new Date().toISOString().slice(0, 10),
      image: "", html: "<p></p>", excerpt: "", keywords: []
    };
    data.entries.push(e); dirty = true; current = e; render();
  }
  function deleteEntry() {
    if (!current || !confirm("确定删除「" + current.title + "」吗？保存后将无法从网站访问。")) return;
    data.entries = data.entries.filter((x) => x !== current);
    current = null; dirty = true; render();
  }

  /* ---------- 编辑器 ---------- */
  function fieldInput(label, key, opts = {}) {
    const input = opts.area
      ? h("textarea", { spellcheck: "false" })
      : h("input", { type: opts.type || "text" });
    if (opts.list) input.setAttribute("list", opts.list);
    input.value = current[key] == null ? "" : current[key];
    input.addEventListener("input", () => { current[key] = opts.number ? Number(input.value) || 0 : input.value; dirty = true; mark(); });
    return h("div", { class: "field" }, h("label", null, label), input);
  }

  function editor() {
    if (!current) return h("div", { class: "empty-state" }, h("div", null, h("p", null, "从左侧选择一个词条开始编辑"), h("p", { class: "hintline" }, "或点击「＋ 新增词条」")));

    const preview = h("div", { class: "preview-pane markdown" });
    previewHTML = preview;
    renderPreview();

    const img = h("img", { src: current.image || "../assets/logo.svg", alt: "" });
    const fileInput = h("input", { type: "file", accept: "image/*", style: "display:none" });
    const codeInput = h("input", { type: "text" });
    codeInput.value = current.code || "";
    codeInput.addEventListener("input", () => {
      current.code = codeInput.value; dirty = true; mark();
      if (!slugTouched) { current.slug = current.code.trim() || "entry-" + current.id; slugInput.value = current.slug; }
    });
    let slugTouched = false;
    const slugInput = h("input", { type: "text" });
    slugInput.value = current.slug || "";
    slugInput.addEventListener("input", () => { slugTouched = true; current.slug = slugInput.value.trim(); dirty = true; mark(); });

    const catList = h("datalist", { id: "catlist" }, ...categories().map(([n]) => h("option", { value: n })));

    const excerpt = h("div", { class: "field" }, h("label", null, "摘要（列表页显示）"),
      (() => { const t = h("textarea", { spellcheck: "false", style: "min-height:70px" }); t.value = current.excerpt || ""; t.addEventListener("input", () => { current.excerpt = t.value; dirty = true; mark(); }); return t; })());

    const kwBox = h("div", { class: "kw-list" });
    const paintKw = () => {
      kwBox.replaceChildren(...(current.keywords || []).map((k, i) =>
        h("span", { class: "kw" }, k.image ? h("img", { src: k.image, alt: "" }) : null, h("span", null, k.title),
          h("button", { title: "移除", onclick: () => { current.keywords.splice(i, 1); dirty = true; mark(); paintKw(); } }, "×"))
      ));
      if (!current.keywords || !current.keywords.length) kwBox.appendChild(h("span", { class: "hintline" }, "暂无关联词条"));
    };
    paintKw();
    const kwAdd = h("input", { list: "kwlist", placeholder: "输入词条名后回车添加", style: "max-width:320px" });
    const kwData = h("datalist", { id: "kwlist" }, ...data.entries.map((e) => h("option", { value: e.title })));
    kwAdd.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      const t = kwAdd.value.trim(); if (!t) return;
      const target = data.entries.find((x) => x.title === t);
      current.keywords = current.keywords || [];
      if (!current.keywords.some((k) => k.title === t)) current.keywords.push({ title: t, slug: target ? target.slug : null, image: target ? target.image : null });
      kwAdd.value = ""; dirty = true; mark(); paintKw();
    });

    return h("div", null,
      h("div", { class: "editor-head" },
        h("div", null,
          h("h2", null, current.title || "（未命名）"),
          h("div", { class: "meta" }, "ID " + current.id + " · " + (current.slug || "—"))
        ),
        h("div", { class: "editor-actions" },
          h("button", { class: "btn ghost", onclick: () => { render(); } }, "重置"),
          h("button", { class: "btn danger", onclick: deleteEntry }, "删除"),
          h("button", { class: "btn primary", onclick: save }, "保存并发布")
        )
      ),

      h("section", { class: "card-sect" },
        h("h3", null, "基本信息"),
        h("div", { class: "row" }, fieldInput("标题", "title"), fieldInput("分类", "category", { list: "catlist" })),
        h("div", { class: "row" }, fieldInput("排序等级", "level", { number: true }), fieldInput("创建日期", "createdAt")),
        h("div", { class: "field" }, h("label", null, "Prefab 代号 (code)"), codeInput,
          h("p", { class: "hintline" }, "饥荒游戏内实体代号，同时用作网址 slug。留空则自动使用 entry-ID。")),
        h("div", { class: "field" }, h("label", null, "网址标识 (slug)"), slugInput)
      ),

      h("section", { class: "card-sect" },
        h("h3", null, "代表图标"),
        h("div", { class: "img-edit" },
          h("div", { class: "img-preview" }, img),
          h("div", { style: "flex:1;min-width:220px" },
            h("div", { style: "display:flex;gap:9px;flex-wrap:wrap" },
              h("button", { class: "btn", onclick: () => fileInput.click() }, "上传图片"),
              h("button", { class: "btn ghost", onclick: () => { current.image = ""; dirty = true; img.src = "../assets/logo.svg"; mark(); } }, "清除")
            ),
            h("p", { class: "hintline" }, "建议 128×128 以内的 PNG，透明背景。上传后自动生成文件名并提交到仓库。")
          )
        ),
        fileInput
      ),

      h("section", { class: "card-sect" },
        h("h3", null, "正文"),
        (() => { const t = h("textarea", { spellcheck: "false", style: "min-height:260px" }); t.value = current.html || ""; t.addEventListener("input", () => { current.html = t.value; dirty = true; mark(); renderPreview(); }); return t; })(),
        h("div", { style: "display:flex;gap:9px;margin-top:12px" },
          h("button", { class: "btn ghost", onclick: () => { current.excerpt = plain(current.html).slice(0, 110); dirty = true; render(); } }, "由正文生成摘要")
        ),
        preview
      ),

      h("section", { class: "card-sect" },
        h("h3", null, "关联词条"),
        kwBox, kwAdd, kwData
      ),
      catList
    );
  }

  function renderPreview() {
    if (previewHTML && current) previewHTML.innerHTML = current.html || "<p style='color:var(--muted)'>（空）</p>";
  }

  function mark() {
    let bar = $(".status");
    if (!bar) {
      bar = h("div", { class: "status" }, h("span", { class: "dot" }), h("span", { class: "msg" }), h("div", { class: "spacer" }), h("span", { class: "act" }));
      document.body.appendChild(bar);
    }
    $(".msg", bar).textContent = "有未保存的修改";
    const act = $(".act", bar);
    act.replaceChildren(h("button", { class: "btn primary", onclick: save }, "保存并发布"));
    bar.classList.add("show");
  }
  function statusBar(text, html, kind) {
    let bar = $(".status");
    if (!bar) { bar = h("div", { class: "status" }, h("span", { class: "dot" }), h("span", { class: "msg" }), h("div", { class: "spacer" }), h("span", { class: "act" })); document.body.appendChild(bar); }
    $(".msg", bar).innerHTML = text;
    $(".act", bar).innerHTML = html || "";
    bar.classList.add("show");
    if (kind === "ok") setTimeout(() => bar.classList.remove("show"), 9000);
  }

  async function save() {
    if (!current) return;
    if (!current.title || !current.title.trim()) { statusBar("标题不能为空", "", "err"); return; }
    const dup = data.entries.find((x) => x.slug === current.slug && x !== current);
    if (dup) { statusBar("slug 与「" + dup.title + "」重复，请修改", "", "err"); return; }
    if (!data.meta) data.meta = {};
    data.meta.updatedAt = new Date().toISOString();
    statusBar('<span class="spin"></span> 正在提交到 GitHub…');
    try {
      const url = await saveData("chore(admin): 更新「" + current.title + "」");
      statusBar("已提交 ✓ 网站将在约 1 分钟后自动更新。", url ? '<a href="' + url + '" target="_blank" rel="noopener" style="color:var(--gold)">查看提交</a>' : "", "ok");
    } catch (e) {
      if (e.status === 409) { statusBar("数据已被其他人修改，正在重新载入，请重试。", "", "err"); try { await loadData(); render(); } catch (_) {} }
      else statusBar("保存失败：" + e.message, "", "err");
    }
  }

  function renderEditor() {
    const main = $(".admin-editor");
    if (main) main.replaceChildren(editor());
  }

  // 选中变化/脏标记时刷新编辑器
  const _render = render;
  render = function () {
    _render();
    if (data && current) renderEditor();
    if (dirty && data) mark();
  };

  /* ---------- 启动 ---------- */
  async function boot() {
    statusBar('<span class="spin"></span> 正在读取数据…');
    try { await loadData(); } catch (e) { renderLogin("读取数据失败：" + e.message, "err"); return; }
    if (!current && data.entries.length) current = data.entries[0];
    render();
    const bar = $(".status"); if (bar) bar.classList.remove("show");
  }

  document.addEventListener("DOMContentLoaded", async () => {
    document.documentElement.setAttribute("data-theme", localStorage.getItem("wws.theme") || "dark");
    if (!OWNER || !NAME) { renderLogin("部署配置缺失：仓库信息未注入。请在构建时设置 GH_OWNER / GH_REPO。", "err"); return; }
    token = localStorage.getItem(LS) || "";
    if (token) {
      try { await restore(); return boot(); }
      catch (e) { localStorage.removeItem(LS); token = ""; renderLogin("登录已失效，请重新登录。"); return; }
    }
    renderLogin();
  });

  // select/addEntry 里调用的 render() 会走上面被包装的版本；此处导出给内联 onclick
  window.__adminSelect = select;
})();
