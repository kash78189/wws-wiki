/* 万物书 · 幻想图鉴 —— 前端交互（零依赖） */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------------- 主题 ---------------- */
  const THEME_KEY = "wws.theme";
  const root = document.documentElement;
  const saved = (() => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } })();
  root.dataset.theme = saved === "light" ? "light" : "dark";

  const themeBtn = $("#theme-toggle");
  const syncThemeIcon = () => {
    if (!themeBtn) return;
    const dark = root.dataset.theme !== "light";
    themeBtn.innerHTML = dark
      ? '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    themeBtn.setAttribute("aria-label", dark ? "切换到浅色模式" : "切换到深色模式");
  };
  syncThemeIcon();
  themeBtn?.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
    try { localStorage.setItem(THEME_KEY, root.dataset.theme); } catch {}
    syncThemeIcon();
  });

  /* ---------------- 轻提示 ---------------- */
  let toastEl = $(".toast");
  const toast = (msg) => {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 1800);
  };

  /* ---------------- 全局搜索框 ---------------- */
  const headerInput = $("#global-search");
  const headerForm = $("#global-search-form");
  const heroInput = $("#hero-search-input");
  const isHome = document.body.dataset.page === "home";
  if (headerInput) {
    headerInput.value = new URL(location.href).searchParams.get("q") || "";
    headerInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") headerInput.value = "";
    });
  }
  const goSearch = (q) => {
    const url = new URL(isHome ? location.pathname : "../index.html", location.href);
    if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
    location.href = url.toString();
  };
  headerForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (isHome) {
      heroInput && (heroInput.value = headerInput.value);
      applyFilters();
      document.getElementById("grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      goSearch(headerInput.value.trim());
    }
  });

  /* ---------------- 首页筛选 ---------------- */
  const grid = $("#grid");
  if (grid) {
    const cards = $$(".card", grid);
    const chips = $$("#chips .chip");
    const sortSel = $("#sort");
    const note = $("#note");
    const empty = $("#empty");
    const params = new URL(location.href).searchParams;

    const state = {
      q: (params.get("q") || "").trim().toLowerCase(),
      cat: params.get("cat") || "*",
      sort: params.get("sort") || "default",
    };
    if (heroInput) heroInput.value = params.get("q") || "";

    const haystack = (c) =>
      `${c.dataset.title} ${c.dataset.code} ${c.dataset.keywords} ${c.dataset.excerpt}`.toLowerCase();

    const total = cards.length;
    let visible = total;

    function applyFilters() {
      if (heroInput) state.q = heroInput.value.trim().toLowerCase();
      visible = 0;
      for (const c of cards) {
        const okCat = state.cat === "*" || c.dataset.cat === state.cat;
        const okQ = !state.q || haystack(c).includes(state.q);
        const show = okCat && okQ;
        c.hidden = !show;
        if (show) visible++;
      }
      // 计数与 chip 状态
      for (const chip of chips) {
        const on = chip.dataset.cat === state.cat;
        chip.classList.toggle("active", on);
        chip.setAttribute("aria-pressed", on ? "true" : "false");
      }
      if (note) {
        const catName = state.cat === "*" ? "全部" : (chips.find((c) => c.dataset.cat === state.cat)?.dataset.name || "");
        note.innerHTML = state.q
          ? `搜索“<b>${escapeHtml(state.q)}</b>” · 在 <b>${catName}</b> 中找到 <b>${visible}</b> 个词条`
          : `共 <b>${visible}</b> 个词条${state.cat === "*" ? "" : ` · 分类「<b>${catName}</b>」`}`;
      }
      if (empty) empty.hidden = visible !== 0;
      syncURL();
    }

    function syncURL() {
      const url = new URL(location.href);
      state.q ? url.searchParams.set("q", heroInput ? heroInput.value.trim() : state.q) : url.searchParams.delete("q");
      state.cat !== "*" ? url.searchParams.set("cat", state.cat) : url.searchParams.delete("cat");
      state.sort !== "default" ? url.searchParams.set("sort", state.sort) : url.searchParams.delete("sort");
      history.replaceState(null, "", url);
    }

    function applySort() {
      const key = state.sort;
      const list = [...cards];
      if (key === "name") list.sort((a, b) => a.dataset.title.localeCompare(b.dataset.title, "zh-Hans-CN"));
      else if (key === "new") list.sort((a, b) => (b.dataset.created || "").localeCompare(a.dataset.created || ""));
      else list.sort((a, b) => Number(a.dataset.order) - Number(b.dataset.order));
      for (const c of list) grid.appendChild(c);
    }

    chips.forEach((chip) =>
      chip.addEventListener("click", () => {
        state.cat = chip.dataset.cat;
        applyFilters();
      })
    );

    let timer;
    heroInput?.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(applyFilters, 90);
    });
    heroInput?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { heroInput.value = ""; applyFilters(); }
    });

    sortSel?.addEventListener("change", () => {
      state.sort = sortSel.value;
      applySort();
      syncURL();
    });

    applySort();
    applyFilters();

    // 支持从头部分享的 ?q= 直接展示
    if (state.q && heroInput) {
      setTimeout(() => document.getElementById("grid")?.scrollIntoView({ behavior: "smooth" }), 60);
    }

    // “/” 聚焦搜索
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        (heroInput || headerInput)?.focus();
      }
    });
  }

  /* ---------------- 复制 prefab code ---------------- */
  $$("[data-copy]").forEach((el) =>
    el.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(el.dataset.copy);
        toast("已复制：" + el.dataset.copy);
      } catch {
        toast("复制失败，请手动选择");
      }
    })
  );

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
})();
