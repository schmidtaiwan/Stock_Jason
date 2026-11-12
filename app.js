(function () {
  const PAGE_BUILD = 105;
  const PAGE_DATE = "2026-11-12";
  let chartDetailsOn = true;
  let stockDetailsOn = true;
  let usBoardOpen = true;
  let usBriefOpen = true;
  let usRowsOpen = true;
  let usBoardTimer = 0;
  let usBoardBusy = false;
  let chipCostLines = null;
  let stockChipCostLines = null;
  let toolWatchGroupId = "";
  let ocrWorker = null;
  let ocrWorkerPromise = null;
  const $ = function (id) { return document.getElementById(id); };
  const M = window.SJMarket;
  const D = window.SJDrive;
  const C = window.SJChips;

  const TOOL_MENU = [
    { id: "mops", title: "公開資訊觀測", desc: "重訊／營收／財報／法說／內部人／除權息；FinMind＋MOPS" },
    { id: "chipx", title: "籌碼健檢與分點", desc: "集中度／主力成本／紅綠燈；有 FinMind token 可看分點" },
    { id: "screen", title: "籌碼選股", desc: "外資連買、投信首買、主力急買，可交集站上月線" },
    { id: "chipday", title: "籌碼日報", desc: "盤後法人買超／賣超排行（T86）" },
    { id: "ideas", title: "交易點子產生器", desc: "掃描台股，列出進場、停損、停利與風報比" },
    { id: "tech", title: "自動化技術分析師", desc: "日線與週線的支撐壓力、均線、動能與買賣判斷" },
    { id: "news", title: "新聞轉交易策略", desc: "把消息拆成短長期影響、反映程度與失效條件" },
    { id: "test", title: "交易策略回測分析師", desc: "勝率、獲利因子、最大回撤與改進方向" },
    { id: "risk", title: "投資組合風險管理", desc: "配置、相關性、再平衡，以及大盤跌 20% 的避險" },
    { id: "journal", title: "交易日誌分析師", desc: "最近 20 筆的錯誤、錯過的機會與三條個人規則" },
    { id: "predict", title: "台股漲跌預測", desc: "八大類加權評分、歷史回測準確率、CSV 匯出" },
    { id: "report", title: "盤後排序報表", desc: "證交所收盤＋外資／三大法人，依漲跌％或買賣超排序，可下載 HTML" },
    { id: "advise", title: "個股綜合研判", desc: "基本面＋籌碼面＋是否建議買進，並用 K 線標買賣點" }
  ];
  const TOOL_IDS = TOOL_MENU.map(function (t) { return t.id; });

  const state = {
    range: "20d",
    on: { dji: false, spx: false, ndx: true, tw: true, jp: false, kr: false, sox: true, fx: true },
    focus: null,
    focusFrom: null,
    stock: null,
    stockBack: null,
    view: "chart",
    tool: "",
    picks: {},
    plot: null,
    stockPlot: null,
    chartGen: 0,
    stockChartGen: 0,
    foreignGen: 0,
    custom: false,
    from: "",
    to: "",
    chartStyle: "line",
    stockRange: "1y",
    stockCustom: false,
    stockDateFrom: "",
    stockDateTo: "",
    stockStyle: "candle",
    kSel: null,
    kDrag: null,
    stockKSel: null,
    stockKDrag: null
  };

  function newWatchGroupId() {
    return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function emptyBook() {
    const gid = "default";
    return {
      watch: [],
      watchGroups: [{ id: gid, name: "預設", items: [] }],
      watchGroupId: gid,
      watchMode: "full",
      watchShowPnl: true,
      holdings: [],
      journal: [],
      capital: 1000000,
      riskPct: 1,
      profile: "穩健",
      toolOrder: TOOL_IDS.slice()
    };
  }

  let book = emptyBook();
  let saveTimer = 0;
  let importRows = [];
  let liveTimer = 0;
  let liveBusy = false;
  const alertSent = {};

  function normalizeToolOrder(raw) {
    const seen = {};
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (id) {
      if (TOOL_IDS.indexOf(id) >= 0 && !seen[id]) {
        seen[id] = true;
        out.push(id);
      }
    });
    TOOL_IDS.forEach(function (id) {
      if (!seen[id]) out.push(id);
    });
    return out;
  }

  function twName(s) {
    return M && M.toTW ? M.toTW(s) : String(s == null ? "" : s);
  }

  const NOTIFY_MODES = {
    pct: { label: "漲跌%", prefix: "±", suffix: "%", def: 3 },
    priceUp: { label: "漲到價", prefix: "≥", suffix: "", def: "" },
    priceDown: { label: "跌到價", prefix: "≤", suffix: "", def: "" },
    pnlUp: { label: "獲利元", prefix: "≥", suffix: "元", def: "" },
    pnlDown: { label: "虧損元", prefix: "≥", suffix: "元", def: "" }
  };

  function notifyModeOf(row) {
    const m = row && row.notifyMode;
    return NOTIFY_MODES[m] ? m : "pct";
  }

  function notifyValOf(row) {
    const mode = notifyModeOf(row);
    const raw = row && row.notifyVal != null ? row.notifyVal : row && row.notifyPct;
    const n = Number(raw);
    if (n > 0 && isFinite(n)) return n;
    return mode === "pct" ? 3 : null;
  }

  function notifyPctOf(row) {
    return notifyModeOf(row) === "pct" ? (notifyValOf(row) || 3) : 3;
  }

  function normalizeNotify(row) {
    const mode = notifyModeOf(row);
    const val = notifyValOf(row);
    row.notify = !!row.notify;
    row.notifyMode = mode;
    row.notifyVal = val;
    row.notifyPct = mode === "pct" ? (val || 3) : notifyPctOf(row);
    return row;
  }

  function normalizeBook(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    function fixRow(row) {
      if (!row || typeof row !== "object") return row;
      const out = Object.assign({}, row);
      if (out.name != null) out.name = twName(out.name);
      if (out.market != null) out.market = twName(out.market);
      const code = String(out.code || (M && M.twStockId ? M.twStockId(out.secid, "") : "") || "")
        .trim().toUpperCase();
      if (code) out.code = code;
      if (!out.secid && code) out.secid = "178." + code;
      if (!out.market) out.market = "台股";
      return normalizeNotify(out);
    }
    let groups = Array.isArray(src.watchGroups) ? src.watchGroups : null;
    if (!groups || !groups.length) {
      groups = [{
        id: "default",
        name: "預設",
        items: Array.isArray(src.watch) ? src.watch.map(fixRow) : []
      }];
    } else {
      groups = groups.map(function (g, i) {
        const items = Array.isArray(g && g.items) ? g.items.map(fixRow)
          : (i === 0 && Array.isArray(src.watch) ? src.watch.map(fixRow) : []);
        return {
          id: String((g && g.id) || ("g" + i)),
          name: String((g && g.name) || ("群組" + (i + 1))).trim().slice(0, 16) || ("群組" + (i + 1)),
          items: items
        };
      });
    }
    let gid = String(src.watchGroupId || groups[0].id);
    if (!groups.some(function (g) { return g.id === gid; })) gid = groups[0].id;
    const active = groups.find(function (g) { return g.id === gid; }) || groups[0];
    return {
      watch: active.items,
      watchGroups: groups,
      watchGroupId: gid,
      watchMode: src.watchMode === "mini" ? "mini" : "full",
      watchShowPnl: src.watchShowPnl !== false,
      holdings: Array.isArray(src.holdings) ? src.holdings.map(fixRow) : [],
      journal: Array.isArray(src.journal) ? src.journal.map(fixRow) : [],
      capital: Number(src.capital) > 0 ? Number(src.capital) : 1000000,
      riskPct: Number(src.riskPct) > 0 ? Number(src.riskPct) : 1,
      profile: src.profile || "穩健",
      toolOrder: normalizeToolOrder(src.toolOrder)
    };
  }

  function activeWatchGroup() {
    const groups = book.watchGroups || [];
    let g = groups.find(function (row) { return row.id === book.watchGroupId; });
    if (!g) g = groups[0];
    return g || null;
  }

  function flushWatchToGroup() {
    const g = activeWatchGroup();
    if (!g) return;
    g.items = book.watch || [];
  }

  function loadWatchFromGroup() {
    const g = activeWatchGroup();
    book.watch = g && Array.isArray(g.items) ? g.items : [];
  }

  function isWatchMini() {
    return book.watchMode === "mini";
  }

  function isWatchShowPnl() {
    return book.watchShowPnl !== false;
  }

  function syncWatchPnlUi() {
    const on = isWatchShowPnl();
    const cb = $("watch-pnl-toggle");
    if (cb) cb.checked = on;
    const board = $("watch-board");
    if (board) board.classList.toggle("watch-hide-pnl", !on);
    const total = $("watch-total");
    if (total) total.hidden = !on;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function fmt(n) {
    if (!isFinite(n)) return "—";
    const a = Math.abs(n);
    const digits = a >= 1000 ? 2 : 2;
    return n.toLocaleString("zh-Hant", { maximumFractionDigits: digits, minimumFractionDigits: a >= 100 ? 2 : 2 });
  }

  function pct(n) {
    if (!isFinite(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + (n * 100).toFixed(1) + "%";
  }

  function pctClass(n) {
    if (!isFinite(n) || n === 0) return "";
    return n > 0 ? "up" : "down";
  }

  function showVer() {
    const text = "版次 " + PAGE_BUILD + " (" + PAGE_DATE + ")";
    $("gate-ver").textContent = text;
    $("pageVer").textContent = text;
  }

  function showApp() {
    $("gate").hidden = true;
    $("app").hidden = false;
    paintChrome(false);
    // 進站／登入後紅框先抓加權，再載圖
    paintTwii(true).then(function () {
      if (state.view === "chart") loadChart();
    });
  }

  function paintChrome(skipTwii) {
    const account = D.account();
    $("who").textContent = account ? account.email : "尚未登入";
    $("login").hidden = !!account;
    $("logout").hidden = !account;
    $("watch-note").textContent = "";
    $("prefer").textContent = (window.GOOGLE_CONFIG.editors || []).join(" 或 ");
    if (!skipTwii) paintTwii(false);
  }

  let twiiBusy = false;
  let twiiSeq = 0;
  function twiiSourceLabel(source) {
    const key = String(source || "").toLowerCase();
    if (key === "mis") return "證交所 MIS";
    if (key === "yahoo") return "Yahoo";
    if (key === "cnyes") return "鉅亨";
    return source ? String(source) : "—";
  }

  function paintTwiiSource(q) {
    const srcEl = $("twii-src");
    if (!srcEl) return;
    srcEl.textContent = "來源 " + twiiSourceLabel(q && q.source);
    srcEl.title = q && q.source === "mis"
      ? "台灣證交所基本市況報導（約 5 秒快照）"
      : (q && q.source === "yahoo" ? "Yahoo Finance" : "股價資料來源");
  }

  function formatTwiiLag(q) {
    const lagEl = $("twii-lag");
    if (!lagEl) return;
    if (!isTwMarketOpen()) {
      lagEl.hidden = true;
      lagEl.textContent = "";
      return;
    }
    let mins = null;
    if (q && q.asOf != null && isFinite(q.asOf)) {
      mins = Math.max(0, Math.floor((Date.now() - Number(q.asOf)) / 60000));
    } else if (q && q.delayMin != null && isFinite(q.delayMin) && q.delayMin > 0) {
      mins = Math.round(q.delayMin);
    }
    // 開盤中延遲達 1 分鐘才顯示；Yahoo 台股常見約 15～20 分延遲
    if (mins == null || mins < 1) {
      lagEl.hidden = true;
      lagEl.textContent = "";
      return;
    }
    lagEl.hidden = false;
    lagEl.textContent = mins >= 60
      ? (Math.floor(mins / 60) + " 小時前")
      : (mins + " 分鐘前");
  }

  async function paintTwii(force) {
    const priceEl = $("twii-price");
    const chgEl = $("twii-chg");
    if (!priceEl || !chgEl) return;
    if (twiiBusy && !force) return;
    const seq = ++twiiSeq;
    twiiBusy = true;
    const hadPrice = priceEl.textContent && priceEl.textContent !== "—" && priceEl.textContent !== "…";
    if (force && !hadPrice) {
      priceEl.textContent = "…";
      priceEl.className = "";
      chgEl.className = "twii-chg";
      chgEl.textContent = "讀取中";
      if ($("twii-lag")) { $("twii-lag").hidden = true; $("twii-lag").textContent = ""; }
      if ($("twii-src")) $("twii-src").textContent = "來源 …";
    } else if (force && $("twii-src") && !hadPrice) {
      $("twii-src").textContent = "來源 …";
    }
    try {
      const q = await M.twiiQuote();
      if (seq !== twiiSeq) return;
      const cls = pctClass((q.pct || 0) / 100);
      priceEl.textContent = fmt(q.price);
      priceEl.className = cls;
      const pts = q.change == null || !isFinite(q.change) ? "—" :
        ((q.change > 0 ? "+" : "") + q.change.toFixed(2) + " 點");
      const pctTxt = q.pct == null || !isFinite(q.pct) ? "" :
        "（" + (q.pct > 0 ? "+" : "") + q.pct.toFixed(2) + "%）";
      chgEl.className = "twii-chg " + cls;
      chgEl.textContent = pts + pctTxt;
      formatTwiiLag(q);
      paintTwiiSource(q);
    } catch (err) {
      if (seq !== twiiSeq) return;
      if (!hadPrice) {
        priceEl.textContent = "—";
        priceEl.className = "";
        chgEl.className = "twii-chg";
        chgEl.textContent = "加權讀取失敗";
        paintTwiiSource(null);
      } else {
        chgEl.textContent = (chgEl.textContent || "").replace(/（更新失敗）$/, "") + "（更新失敗）";
      }
      if ($("twii-lag")) { $("twii-lag").hidden = true; $("twii-lag").textContent = ""; }
    } finally {
      if (seq === twiiSeq) twiiBusy = false;
    }
  }

  function setWatchCompose(open) {
    const board = $("watch-board");
    const compose = $("watch-compose");
    const openBtn = $("watch-open-add");
    if (!board || !compose) return;
    board.hidden = !!open;
    compose.hidden = !open;
    if (openBtn) openBtn.hidden = !!open;
    if (open) {
      const q = $("watch-q");
      if (q) setTimeout(function () { q.focus(); }, 0);
    } else {
      renderWatch();
    }
  }

  function setView(name) {
    state.view = name;
    $("view-chart").hidden = name !== "chart";
    if ($("view-stock")) $("view-stock").hidden = name !== "stock";
    if ($("view-pulse")) $("view-pulse").hidden = name !== "pulse";
    $("view-watch").hidden = name !== "watch";
    $("view-tools").hidden = name !== "tools";
    $("view-tool").hidden = name !== "tool";
    const dockView = name === "tool" ? "tools" : name === "stock" ? "watch" : name;
    document.querySelectorAll(".dock button").forEach(function (btn) {
      const on = btn.getAttribute("data-view") === dockView;
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    if (name === "chart") {
      loadChart();
    }
    if (name === "stock") {
      buildStockToggles();
      paintStockHeader();
      syncStockDetailsUi();
      loadStockChart();
      if (state.stock) loadStockDetail(state.stock);
    }
    if (name === "pulse") {
      syncUsBoardFoldUi();
      loadPulse();
      loadUsBoard();
      startUsBoardClock();
    } else {
      stopUsBoardClock();
    }
    if (name === "watch") {
      setWatchCompose(false);
      renderWatch();
    }
    if (name === "tools") paintToolMenu();
  }

  function paintToolMenu() {
    const box = $("tool-menu");
    if (!box) return;
    book.toolOrder = normalizeToolOrder(book.toolOrder);
    const byId = {};
    TOOL_MENU.forEach(function (t) { byId[t.id] = t; });
    box.innerHTML = book.toolOrder.map(function (id) {
      const t = byId[id];
      if (!t) return "";
      return '<div class="menu-row" data-tool-row="' + t.id + '">' +
        '<button type="button" class="menu-open" data-tool="' + t.id + '">' +
        esc(t.title) + "<small>" + esc(t.desc) + "</small></button>" +
        '<button type="button" class="ghost menu-drag" data-tool-drag="' + t.id + '"' +
        ' aria-label="拖曳調整順序" title="拖曳調整順序">⋮⋮</button></div>';
    }).join("");
  }

  let toolDrag = null;

  function syncToolOrderFromDom() {
    const box = $("tool-menu");
    if (!box) return;
    const ids = Array.prototype.map.call(box.querySelectorAll("[data-tool-row]"), function (row) {
      return row.getAttribute("data-tool-row");
    });
    book.toolOrder = normalizeToolOrder(ids);
  }

  function bindToolMenuDrag() {
    const box = $("tool-menu");
    if (!box || box.dataset.dragBound) return;
    box.dataset.dragBound = "1";

    function endToolDrag() {
      if (!toolDrag) return;
      const id = toolDrag.id;
      toolDrag = null;
      const row = box.querySelector('[data-tool-row="' + id + '"]');
      if (row) row.classList.remove("is-dragging");
      syncToolOrderFromDom();
      scheduleSave();
    }

    box.addEventListener("pointerdown", function (ev) {
      const handle = ev.target.closest("[data-tool-drag]");
      if (!handle || !box.contains(handle)) return;
      const id = handle.getAttribute("data-tool-drag");
      const row = handle.closest("[data-tool-row]");
      if (!id || !row) return;
      toolDrag = { id: id, pointerId: ev.pointerId };
      row.classList.add("is-dragging");
      try { handle.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
      ev.preventDefault();
    });

    box.addEventListener("pointermove", function (ev) {
      if (!toolDrag) return;
      const dragging = box.querySelector('[data-tool-row="' + toolDrag.id + '"]');
      if (!dragging) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const over = el && el.closest ? el.closest("#tool-menu [data-tool-row]") : null;
      if (!over || over === dragging || !box.contains(over)) return;
      const rect = over.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (ev.clientY < mid) box.insertBefore(dragging, over);
      else box.insertBefore(dragging, over.nextSibling);
    });

    box.addEventListener("pointerup", endToolDrag);
    box.addEventListener("pointercancel", endToolDrag);
  }

  function openTool(id) {
    const titles = {
      mops: "公開資訊觀測",
      chipx: "籌碼健檢與分點",
      screen: "籌碼選股",
      chipday: "籌碼日報",
      ideas: "交易點子產生器",
      tech: "自動化技術分析師",
      news: "新聞轉交易策略",
      test: "交易策略回測分析師",
      risk: "投資組合風險管理",
      journal: "交易日誌分析師",
      predict: "台股漲跌預測",
      report: "盤後排序報表",
      advise: "個股綜合研判"
    };
    state.tool = id;
    $("tool-title").textContent = titles[id] || "";
    const note = $("tool-note");
    if (note) {
      if (id === "report" || id === "chipday") {
        note.hidden = false;
        note.textContent = id === "chipday" ? "約17:00後更新" : "每日16:00後更新";
      } else {
        note.hidden = true;
        note.textContent = "";
      }
    }
    TOOL_IDS.forEach(function (key) {
      const panel = $("panel-" + key);
      if (panel) panel.hidden = key !== id;
    });
    setView("tool");
    if (id === "risk") renderHoldings();
    if (id === "journal") renderJournal();
    if (id === "predict") syncPredictStockBox();
    if (id === "report" && $("report-date")) $("report-date").value = taipeiDay();
    paintToolWatchPick(id);
    if (id === "chipx") {
      if ($("chipx-token") && C) $("chipx-token").value = C.getToken() || "";
      syncChipxTokenStatus();
    }
    syncMoney();
  }

  function syncChipxTokenStatus() {
    const el = $("chipx-token-status");
    if (!el || !C) return;
    el.textContent = C.getToken()
      ? "已儲存 token（本機）。分點資料會優先走 FinMind 付費接口。"
      : "尚未設定 token：仍可用法人／融資做健檢與主力成本近似。";
  }

  const TOOL_WATCH_META = {
    mops: { q: "mops-q", pickLabel: "mops-pick", hits: "mops-hits", pickKey: "mops" },
    chipx: { q: "chipx-q", pickLabel: "chipx-pick", hits: "chipx-hits", pickKey: "chipx" },
    tech: { q: "tech-q", pickLabel: "tech-pick", hits: "tech-hits", pickKey: "tech" },
    news: { q: "news-q", pickLabel: "news-pick", hits: "news-hits", pickKey: "news" },
    test: { q: "test-q", pickLabel: "test-pick", hits: "test-hits", pickKey: "test" },
    advise: { q: "advise-q", pickLabel: "advise-pick", hits: "advise-hits", pickKey: "advise", autoRun: true },
    journal: { q: "j-q", pickLabel: "j-pick", hits: "j-hits", pickKey: "journal" },
    predict: { q: "predict-q", pickLabel: "predict-pick", hits: "predict-hits", pickKey: "predict" },
    risk: { mode: "holding" },
    ideas: { redirect: "advise", hint: "點自選個股可轉去綜合研判" },
    screen: { redirect: "advise", hint: "全市場選股；點自選個股可轉去綜合研判" },
    chipday: { redirect: "advise", hint: "全市場日報；點自選個股可轉去綜合研判" },
    report: { redirect: "advise", hint: "全市場報表；點自選個股可轉去綜合研判" }
  };

  function toolWatchActiveGroup() {
    flushWatchToGroup();
    const groups = book.watchGroups || [];
    if (!groups.length) return null;
    const id = toolWatchGroupId || book.watchGroupId;
    return groups.find(function (g) { return g.id === id; }) || groups[0];
  }

  function paintToolWatchPick(toolId) {
    const box = document.querySelector('[data-tool-watch="' + toolId + '"]');
    if (!box) return;
    const meta = TOOL_WATCH_META[toolId] || {};
    const groups = book.watchGroups || [];
    const g = toolWatchActiveGroup();
    if (!g) {
      box.innerHTML = '<p class="fine tool-watch-empty">尚無自選群組，請先到自選建立。</p>';
      return;
    }
    toolWatchGroupId = g.id;
    const groupHtml = groups.map(function (row) {
      const on = row.id === g.id;
      return '<button type="button" class="chip tool-watch-group" data-tool-watch-group="' +
        esc(row.id) + '" data-tool-watch-for="' + esc(toolId) + '" aria-pressed="' +
        (on ? "true" : "false") + '">' + esc(row.name) +
        '<span class="watch-group-count">' + (row.items || []).length + "</span></button>";
    }).join("");
    const items = g.items || [];
    let stockHtml;
    if (!items.length) {
      stockHtml = '<span class="fine">此群組沒有個股。</span>';
    } else {
      stockHtml = items.map(function (item, idx) {
        const label = ((item.name || "") + " " + (item.code || "")).trim();
        return '<button type="button" class="chip" data-tool-watch-item="' + esc(toolId) +
          '" data-tool-watch-idx="' + idx + '">' + esc(label) + "</button>";
      }).join("");
    }
    const hint = meta.hint
      ? '<p class="fine tool-watch-hint">' + esc(meta.hint) + "</p>"
      : '<p class="fine tool-watch-hint">自選群組／個股（點選帶入分析）</p>';
    box.innerHTML = hint +
      '<div class="tool-watch-groups">' + groupHtml + "</div>" +
      '<div class="tool-watch-stocks chips">' + stockHtml + "</div>";
  }

  function applyToolWatchItem(toolId, item) {
    if (!item) return;
    const row = {
      secid: item.secid,
      code: item.code,
      name: item.name || "",
      market: item.market || "台股"
    };
    const meta = TOOL_WATCH_META[toolId] || {};
    if (meta.mode === "holding") {
      if (!book.holdings.some(function (h) { return h.secid === row.secid; })) {
        book.holdings.push(Object.assign({
          shares: item.shares > 0 ? item.shares : 1,
          cost: item.cost == null ? "" : item.cost
        }, row));
        scheduleSave();
      }
      renderHoldings();
      return;
    }
    if (meta.redirect) {
      state.picks.advise = row;
      if ($("advise-q")) $("advise-q").value = (row.code || "") + " " + (row.name || "");
      if ($("advise-pick")) $("advise-pick").textContent = row.name + " " + row.code + " · 自選";
      openTool(meta.redirect);
      if (typeof runAdvise === "function") runAdvise();
      return;
    }
    const key = meta.pickKey || toolId;
    state.picks[key] = row;
    if (meta.pickLabel && $(meta.pickLabel)) {
      $(meta.pickLabel).textContent = row.name + " " + row.code + " · 自選";
    }
    if (meta.hits && $(meta.hits)) $(meta.hits).innerHTML = "";
    if (meta.q && $(meta.q)) $(meta.q).value = (row.code || "") + " " + (row.name || "");
    if (key === "predict" && $("predict-horizon")) {
      $("predict-horizon").value = "stock";
      syncPredictStockBox();
      paintToolWatchPick("predict");
    }
    if (meta.autoRun && typeof runAdvise === "function") runAdvise();
  }

  function syncPredictStockBox() {
    const stock = $("predict-horizon").value === "stock";
    $("predict-stock-box").hidden = !stock;
    if (stock) paintToolWatchPick("predict");
  }

  function syncMoney() {
    $("idea-capital").value = book.capital;
    $("idea-risk").value = book.riskPct;
    $("news-capital").value = book.capital;
    $("news-risk").value = book.riskPct;
    $("risk-profile").value = book.profile;
  }

  function rememberMoney() {
    book.capital = Number($("idea-capital").value) || Number($("news-capital").value) || book.capital;
    book.riskPct = Number($("idea-risk").value) || book.riskPct;
    book.profile = $("risk-profile").value || book.profile;
    scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 300);
  }

  async function persist() {
    try {
      flushWatchToGroup();
      if (D.account()) await D.writeBook(book);
      else sessionStorage.setItem("sj-book", JSON.stringify(book));
    } catch (err) {
      $("who").textContent = "雲端寫入失敗：" + (err.message || err);
    }
  }

  function paintWatchGroups() {
    const box = $("watch-groups");
    if (!box) return;
    flushWatchToGroup();
    const groups = book.watchGroups || [];
    box.innerHTML = groups.map(function (g) {
      const on = g.id === book.watchGroupId;
      return '<button type="button" class="chip watch-group-chip" data-watch-group="' + esc(g.id) +
        '" aria-pressed="' + (on ? "true" : "false") + '">' + esc(g.name) +
        '<span class="watch-group-count">' + (g.items || []).length + "</span></button>";
    }).join("") +
      '<button type="button" class="ghost watch-group-add" id="watch-group-add" title="新增群組" aria-label="新增群組">＋群組</button>' +
      '<button type="button" class="ghost watch-group-icon watch-group-rename" id="watch-group-rename" title="重新命名目前群組" aria-label="重新命名">✎</button>' +
      (groups.length > 1
        ? '<button type="button" class="ghost danger watch-group-icon watch-group-del" id="watch-group-del" title="刪除目前群組" aria-label="刪除群組">🗑</button>'
        : "");
    syncWatchModeBtn();
    syncWatchPnlUi();
  }

  function syncWatchModeBtn() {
    const btn = $("watch-mode-toggle");
    if (!btn) return;
    const mini = isWatchMini();
    btn.setAttribute("aria-pressed", mini ? "true" : "false");
    btn.textContent = mini ? "詳細" : "極簡";
    btn.title = mini ? "切換為詳細列表" : "切換為極簡並排";
  }

  function toggleWatchShowPnl() {
    const cb = $("watch-pnl-toggle");
    book.watchShowPnl = !!(cb && cb.checked);
    scheduleSave();
    syncWatchPnlUi();
    if (book.watchShowPnl) paintWatchTotal();
  }

  function switchWatchGroup(id) {
    if (!id || id === book.watchGroupId) return;
    flushWatchToGroup();
    if (!(book.watchGroups || []).some(function (g) { return g.id === id; })) return;
    book.watchGroupId = id;
    loadWatchFromGroup();
    scheduleSave();
    paintWatchGroups();
    renderWatch(true);
  }

  function addWatchGroup() {
    flushWatchToGroup();
    const name = window.prompt("新群組名稱", "群組" + ((book.watchGroups || []).length + 1));
    if (name == null) return;
    const label = String(name).trim().slice(0, 16) || ("群組" + ((book.watchGroups || []).length + 1));
    const id = newWatchGroupId();
    book.watchGroups.push({ id: id, name: label, items: [] });
    book.watchGroupId = id;
    loadWatchFromGroup();
    scheduleSave();
    paintWatchGroups();
    renderWatch(true);
  }

  function renameWatchGroup() {
    const g = activeWatchGroup();
    if (!g) return;
    const name = window.prompt("群組名稱", g.name || "");
    if (name == null) return;
    g.name = String(name).trim().slice(0, 16) || g.name;
    scheduleSave();
    paintWatchGroups();
  }

  function deleteWatchGroup() {
    flushWatchToGroup();
    if (!(book.watchGroups || []).length || book.watchGroups.length <= 1) return;
    const g = activeWatchGroup();
    if (!g) return;
    if (!window.confirm("刪除群組「" + g.name + "」？群組內標的一併移除。")) return;
    book.watchGroups = book.watchGroups.filter(function (row) { return row.id !== g.id; });
    book.watchGroupId = book.watchGroups[0].id;
    loadWatchFromGroup();
    scheduleSave();
    paintWatchGroups();
    renderWatch(true);
  }

  function toggleWatchMode() {
    book.watchMode = isWatchMini() ? "full" : "mini";
    scheduleSave();
    syncWatchModeBtn();
    renderWatch(true);
  }

  async function loadBook() {
    try {
      if (D.account()) book = normalizeBook(await D.readBook());
      else book = normalizeBook(JSON.parse(sessionStorage.getItem("sj-book") || "null"));
    } catch (err) {
      book = emptyBook();
      $("who").textContent = "讀取雲端失敗：" + (err.message || err);
    }
    syncMoney();
    renderWatch();
    paintToolMenu();
  }

  function warnEmbeddedLogin() {
    if (!D.isEmbeddedBrowser || !D.isEmbeddedBrowser()) return false;
    const url = (D.liveUrl && D.liveUrl()) || "https://schmidtaiwan.github.io/Stock_Jason/";
    const msg = "Cursor 右側瀏覽器無法顯示 Google 登入（會變白頁）。請用 Chrome／Edge 開啟 " + url + " 再登入；這裡仍可按「先看走勢」看圖。";
    if ($("gate-msg")) $("gate-msg").textContent = msg;
    if ($("who") && $("app") && !$("app").hidden) $("who").textContent = msg;
    return true;
  }

  async function doLogin() {
    if (warnEmbeddedLogin()) return;
    $("gate-msg").textContent = "正在開啟 Google 登入…";
    $("gate-login").disabled = true;
    const headerLogin = $("login");
    if (headerLogin) headerLogin.disabled = true;
    try {
      const account = await D.login({ prompt: "select_account", hint: "" });
      if (!D.isAllowed(account.email)) {
        const want = D.allowedEmails().join(" 或 ");
        $("gate-msg").textContent = "現在登入的是 " + account.email + "。請改用 " + want + "。";
        D.logout();
        paintChrome();
        return;
      }
      // 先顯示主畫面，避免雲端／行情等待時看起來像登入後白屏卡住
      $("gate-msg").textContent = "";
      $("gate").hidden = true;
      $("app").hidden = false;
      paintChrome(true);
      if ($("who")) $("who").textContent = account.email + " · 正在同步自選…";
      paintTwii(true).catch(function () { /* 失敗時 paintTwii 已寫狀態 */ });
      try {
        await loadBook();
      } catch (bookErr) {
        book = emptyBook();
        if ($("who")) $("who").textContent = "讀取雲端失敗：" + ((bookErr && bookErr.message) || bookErr);
      }
      paintChrome(true);
      if (state.view === "chart") loadChart();
      else if (state.view === "pulse") loadPulse();
      else if (state.view === "watch") renderWatch(true);
    } catch (err) {
      $("gate-msg").textContent = D.friendly(err);
      if ($("app") && !$("app").hidden) {
        $("who").textContent = D.friendly(err);
      }
    } finally {
      $("gate-login").disabled = false;
      if (headerLogin) headerLogin.disabled = false;
    }
  }

  function buildToggles() {
    $("ranges").innerHTML = Object.keys(M.RANGES).map(function (id) {
      const spec = M.RANGES[id];
      const on = !state.custom && state.range === id;
      return '<button type="button" class="chip" data-range="' + id + '" aria-pressed="' + on + '">' + spec.label + "</button>";
    }).join("");
    $("markets").innerHTML = M.MARKETS.map(function (m) {
      return '<button type="button" class="chip" data-market="' + m.id + '" aria-pressed="' + !!state.on[m.id] + '">' + m.name + "</button>";
    }).join("");
    const styles = $("chart-styles");
    if (styles) {
      styles.querySelectorAll("[data-chart-style]").forEach(function (btn) {
        btn.setAttribute("aria-pressed", btn.dataset.chartStyle === state.chartStyle ? "true" : "false");
      });
    }
    syncDateInputs();
  }

  function buildStockToggles() {
    const box = $("stock-ranges");
    if (!box) return;
    box.innerHTML = Object.keys(M.RANGES).map(function (id) {
      const spec = M.RANGES[id];
      const on = !state.stockCustom && state.stockRange === id;
      return '<button type="button" class="chip" data-stock-range="' + id + '" aria-pressed="' + on + '">' + spec.label + "</button>";
    }).join("");
    const styles = $("stock-styles");
    if (styles) {
      styles.querySelectorAll("[data-stock-style]").forEach(function (btn) {
        btn.setAttribute("aria-pressed", btn.dataset.stockStyle === state.stockStyle ? "true" : "false");
      });
    }
    syncStockDateInputs();
  }

  function setChartStyle(style) {
    state.chartStyle = style === "candle" ? "candle" : "line";
    buildToggles();
  }

  function setStockStyle(style) {
    state.stockStyle = style === "candle" ? "candle" : "line";
    buildStockToggles();
  }

  function syncDateInputs() {
    const from = $("range-from");
    const to = $("range-to");
    if (!from || !to) return;
    if (document.activeElement === from || document.activeElement === to) return;
    if (state.from) from.value = state.from;
    if (state.to) to.value = state.to;
    from.classList.toggle("custom", !!state.custom);
    to.classList.toggle("custom", !!state.custom);
  }

  function syncStockDateInputs() {
    const from = $("stock-from");
    const to = $("stock-to");
    if (!from || !to) return;
    if (document.activeElement === from || document.activeElement === to) return;
    if (state.stockDateFrom) from.value = state.stockDateFrom;
    if (state.stockDateTo) to.value = state.stockDateTo;
    from.classList.toggle("custom", !!state.stockCustom);
    to.classList.toggle("custom", !!state.stockCustom);
  }

  function isoToday() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function isOneDayRange() {
    if (state.custom && state.from && state.to) return state.from === state.to;
    return !state.custom && state.range === "1d";
  }

  function isStockOneDayRange() {
    if (state.stockCustom && state.stockDateFrom && state.stockDateTo) {
      return state.stockDateFrom === state.stockDateTo;
    }
    return !state.stockCustom && state.stockRange === "1d";
  }

  function plotWindow() {
    if (state.custom && state.from && state.to) return { from: state.from, to: state.to };
    if (!state.custom && state.range === "1d") {
      const day = state.from && state.to && state.from === state.to ? state.from : isoToday();
      return { from: day, to: day };
    }
    return null;
  }

  function stockPlotWindow() {
    if (state.stockCustom && state.stockDateFrom && state.stockDateTo) {
      return { from: state.stockDateFrom, to: state.stockDateTo };
    }
    if (!state.stockCustom && state.stockRange === "1d") {
      const day = state.stockDateFrom && state.stockDateTo && state.stockDateFrom === state.stockDateTo
        ? state.stockDateFrom : isoToday();
      return { from: day, to: day };
    }
    return null;
  }

  function fillDatesFromPlot() {
    const plot = state.plot;
    if (!plot || !plot.axis || !plot.axis.length) return;
    let first = "";
    let last = "";
    for (let i = 0; i < plot.axis.length; i++) {
      const d = String(plot.axis[i] || "").slice(0, 10);
      if (d.length >= 10) { first = d; break; }
    }
    for (let i = plot.axis.length - 1; i >= 0; i--) {
      const d = String(plot.axis[i] || "").slice(0, 10);
      if (d.length >= 10) { last = d; break; }
    }
    if (!first || !last) return;
    state.from = first;
    state.to = last;
    syncDateInputs();
  }

  function fillStockDatesFromPlot() {
    const plot = state.stockPlot;
    if (!plot || !plot.axis || !plot.axis.length) return;
    let first = "";
    let last = "";
    for (let i = 0; i < plot.axis.length; i++) {
      const d = String(plot.axis[i] || "").slice(0, 10);
      if (d.length >= 10) { first = d; break; }
    }
    for (let i = plot.axis.length - 1; i >= 0; i--) {
      const d = String(plot.axis[i] || "").slice(0, 10);
      if (d.length >= 10) { last = d; break; }
    }
    if (!first || !last) return;
    state.stockDateFrom = first;
    state.stockDateTo = last;
    syncStockDateInputs();
  }

  function applyCustomDates() {
    const from = $("range-from").value;
    const to = $("range-to").value;
    if (!from || !to) return;
    if (from > to) {
      $("chart-status").textContent = "起始日不能晚於結束日。";
      return;
    }
    state.custom = true;
    state.from = from;
    state.to = to;
    // 只選一天：當天五分 K
    if (from === to) {
      state.range = "1d";
      state.chartStyle = "candle";
    }
    buildToggles();
    loadChart();
  }

  function paintFocus() {
    // 主畫面走勢不再共用個股 focus；個股改走 view-stock
    if ($("market-box")) $("market-box").hidden = false;
    if ($("focus-bar")) $("focus-bar").hidden = true;
  }

  function paintStockHeader() {
    const title = $("stock-title");
    const row = state.stock;
    if (!title) return;
    title.textContent = row
      ? (row.name + " " + row.code + " · " + (row.market || "台股"))
      : "個股";
  }

  function isTwMarketOpen(now) {
    const d = now || new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(d);
    const map = {};
    parts.forEach(function (p) { if (p.type !== "literal") map[p.type] = p.value; });
    const wd = map.weekday;
    if (wd === "Sat" || wd === "Sun") return false;
    const hh = Number(map.hour);
    const mm = Number(map.minute);
    const mins = hh * 60 + mm;
    return mins >= 9 * 60 && mins <= 13 * 60 + 30;
  }

  function liveSecids() {
    const ids = [];
    if (state.stock && state.stock.secid) ids.push(state.stock.secid);
    M.MARKETS.forEach(function (m) {
      if (state.on[m.id]) ids.push(m.secid);
    });
    (book.watch || []).forEach(function (item) {
      if (item.secid) ids.push(item.secid);
    });
    return ids;
  }

  function hasWatchAlerts() {
    return (book.watch || []).some(function (item) { return item.notify; });
  }

  async function liveTick() {
    if (liveBusy || !isTwMarketOpen()) return;
    const alertOn = hasWatchAlerts();
    if (document.hidden && !alertOn) return;
    liveBusy = true;
    try {
      if (M.bustLiveCaches) M.bustLiveCaches(liveSecids());
      if (!document.hidden) paintTwii();
      if (!document.hidden && state.view === "chart") await loadChart();
      else if (!document.hidden && state.view === "watch") paintWatchQuotes();
      else if (alertOn) await pollWatchAlerts();
    } catch (err) {
      /* 下一輪再試 */
    } finally {
      liveBusy = false;
    }
  }

  function stopUsBoardClock() {
    if (usBoardTimer) clearInterval(usBoardTimer);
    usBoardTimer = 0;
  }

  function startUsBoardClock() {
    stopUsBoardClock();
    usBoardTimer = setInterval(function () {
      if (document.hidden || state.view !== "pulse") return;
      loadUsBoard({ quiet: true });
    }, 30000);
  }

  function startLiveClock() {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = setInterval(liveTick, 20000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && isTwMarketOpen()) liveTick();
      else if (document.hidden && hasWatchAlerts() && isTwMarketOpen()) liveTick();
      if (!document.hidden && state.view === "pulse") loadUsBoard({ quiet: true });
    });
  }

  function taipeiDay() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  async function ensureNotifyPermission() {
    if (!("Notification" in window)) {
      $("watch-status").textContent = "這個瀏覽器不支援系統通知。";
      return false;
    }
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      $("watch-status").textContent = "通知權限被拒絕，請到瀏覽器設定開啟。";
      return false;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        $("watch-status").textContent = "尚未允許通知，無法跳出資訊。";
        return false;
      }
      $("watch-status").textContent = "已開啟通知。盤中達門檻會跳出提醒。";
      return true;
    } catch (err) {
      $("watch-status").textContent = "無法請求通知權限。";
      return false;
    }
  }

  function fireWatchNotice(title, body, tag) {
    try {
      new Notification(title, {
        body: body,
        tag: tag || "stock-jason",
        renotify: true,
        silent: false
      });
    } catch (err) { /* 略過 */ }
  }

  function watchAlertHit(item, quote) {
    if (!item || !item.notify || !quote) return null;
    const mode = notifyModeOf(item);
    const val = notifyValOf(item);
    if (!(val > 0)) return null;
    const price = Number(quote.price);
    const pctChg = Number(quote.pct);
    const pnl = watchPnl(price, item.cost, item.shares, item.code).value;
    if (mode === "pct") {
      if (!isFinite(pctChg) || Math.abs(pctChg) < val) return null;
      const side = pctChg >= 0 ? "up" : "down";
      const sign = pctChg > 0 ? "+" : "";
      return {
        key: side + "|pct|" + val,
        body: "幅度 " + sign + pctChg.toFixed(2) + "%（門檻 ±" + val + "%）· 成交 " + fmtPx(price)
      };
    }
    if (mode === "priceUp") {
      if (!isFinite(price) || price < val) return null;
      return { key: "priceUp|" + val, body: "漲到 " + fmtPx(price) + "（門檻 ≥" + fmtPx(val) + "）" };
    }
    if (mode === "priceDown") {
      if (!isFinite(price) || price > val) return null;
      return { key: "priceDown|" + val, body: "跌到 " + fmtPx(price) + "（門檻 ≤" + fmtPx(val) + "）" };
    }
    if (mode === "pnlUp") {
      if (pnl == null || !isFinite(pnl) || pnl < val) return null;
      return {
        key: "pnlUp|" + val,
        body: "獲利 " + fmt(pnl) + " 元（門檻 ≥" + fmt(val) + "）· 成交 " + fmtPx(price)
      };
    }
    if (mode === "pnlDown") {
      if (pnl == null || !isFinite(pnl) || pnl > -val) return null;
      return {
        key: "pnlDown|" + val,
        body: "虧損 " + fmt(Math.abs(pnl)) + " 元（門檻 ≥" + fmt(val) + "）· 成交 " + fmtPx(price)
      };
    }
    return null;
  }

  function checkWatchAlertsFromRows(items, rows) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const day = taipeiDay();
    (items || []).forEach(function (item, idx) {
      if (!item || !item.notify) return;
      const hit = watchAlertHit(item, rows && rows[idx]);
      if (!hit) return;
      const key = (item.secid || item.code) + "|" + day + "|" + hit.key;
      if (alertSent[key]) return;
      alertSent[key] = true;
      fireWatchNotice(
        twName(item.name || "") + " " + (item.code || ""),
        hit.body,
        "watch-" + (item.code || idx)
      );
    });
  }

  async function pollWatchAlerts() {
    const items = (book.watch || []).filter(function (item) { return item.notify; });
    if (!items.length) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const rows = await M.watchBoard(items);
      checkWatchAlertsFromRows(items, rows);
    } catch (err) { /* 下一輪 */ }
  }

  function moneyText(n) {
    if (n == null || !isFinite(n)) return "—";
    return (n > 0 ? "+" : "") + n.toFixed(1);
  }

  async function renderForeign() {
    const box = $("foreign");
    if (!box) return;
    const gen = ++state.foreignGen;
    const order = ["1d", "5d", "20d", "180d", "1y"];
    if (!box.dataset.ready) box.textContent = "正在讀外資買賣超…";
    try {
      const nets = await M.foreignNets();
      if (gen !== state.foreignGen) return;
      box.dataset.ready = "1";
      box.innerHTML = '<p class="fine">外資買賣超（億元）</p><div class="chips">' + order.map(function (id) {
        const v = nets[id];
        const cls = (v > 0 ? "up" : v < 0 ? "down" : "") + (!state.custom && state.range === id ? " on" : "");
        return '<span class="' + cls + '">' + esc(M.RANGES[id].label) + " " + moneyText(v) + "</span>";
      }).join("") + "</div>";
    } catch (err) {
      if (gen === state.foreignGen) box.textContent = "外資買賣超這次沒讀到。";
    }
  }

  async function loadChart() {
    const gen = ++state.chartGen;
    $("chart-status").textContent = "正在讀行情…";
    paintFocus();
    renderForeign();
    try {
      let items = [];
      let statusNote = "";
      const win = plotWindow();
      const align = win
        ? ((Date.parse(win.to) - Date.parse(win.from)) / 86400000 <= 5 ? "index" : "date")
        : ((M.RANGES[state.range] || {}).align || "date");
      const picked = M.MARKETS.filter(function (m) { return state.on[m.id]; });
      if (!picked.length) {
        $("chart-status").textContent = "至少選擇一個市場。";
        renderKPatterns(null);
        return;
      }
      const got = await Promise.all(picked.map(async function (m) {
        try { return { name: m.name, color: m.color, bars: await M.bars(m.secid, state.range, win) }; }
        catch (err) { return { name: m.name, error: err.message || "失敗" }; }
      }));
      if (gen !== state.chartGen) return;
      items = got.filter(function (row) { return row.bars && row.bars.length; });
      const bad = got.filter(function (row) { return !row.bars; }).map(function (row) { return row.name; });
      if (!items.length) throw new Error("行情暫時讀不到");
      statusNote = bad.length ? bad.join("、") + " 這次沒讀到。" : "";
      if (gen !== state.chartGen) return;
      // 單日區間強制 K 線（五分）
      if (isOneDayRange() && state.chartStyle !== "candle") {
        state.chartStyle = "candle";
        buildToggles();
      }
      const candle = state.chartStyle === "candle";
      if (candle && items.length > 1) {
        const tw = items.find(function (row) { return row.name === "台股"; });
        items = [tw || items[0]];
        statusNote = (statusNote ? statusNote + " " : "") + "K線只顯示 " + items[0].name + "。";
      }
      if (candle && isOneDayRange()) {
        statusNote = (statusNote ? statusNote + " " : "") + "單日五分 K。";
      }
      const mode = candle || items.length === 1 ? "price" : "pct";
      state.plot = buildPlot(items, mode, align);
      state.plot.style = candle ? "candle" : "line";
      if (!candle) clearKSelection();
      else {
        state.kSel = null;
        state.kDrag = null;
        renderKPick(null);
      }
      draw();
      renderLegend(items, mode);
      renderKPatterns(candle ? items[0] : null);
      fillDatesFromPlot();
      $("chart-status").textContent = statusNote;
    } catch (err) {
      if (gen === state.chartGen) {
        $("chart-status").textContent = err.message || "讀取失敗";
        renderKPatterns(null);
      }
    }
  }

  async function loadStockChart() {
    const row = state.stock;
    const status = $("stock-chart-status");
    if (!row) {
      if (status) status.textContent = "尚未選擇個股。";
      return;
    }
    const gen = ++state.stockChartGen;
    if (status) status.textContent = "正在讀 " + row.name + "…";
    paintStockHeader();
    try {
      const win = stockPlotWindow();
      const align = win
        ? ((Date.parse(win.to) - Date.parse(win.from)) / 86400000 <= 5 ? "index" : "date")
        : ((M.RANGES[state.stockRange] || {}).align || "date");
      const series = await M.bars(row.secid, state.stockRange, win);
      if (gen !== state.stockChartGen) return;
      if (!series || !series.length) throw new Error("個股行情暫時讀不到");
      let statusNote = "";
      if (isStockOneDayRange() && state.stockStyle !== "candle") {
        state.stockStyle = "candle";
        buildStockToggles();
      }
      const candle = state.stockStyle === "candle";
      if (candle && isStockOneDayRange()) statusNote = "單日五分 K。";
      const items = [{ name: row.name, color: "#e0a100", bars: series }];
      state.stockPlot = buildPlot(items, "price", align);
      state.stockPlot.style = candle ? "candle" : "line";
      if (!candle) clearStockKSelection();
      else {
        state.stockKSel = null;
        state.stockKDrag = null;
        renderStockKPick(null);
      }
      drawStock();
      renderStockLegend(items);
      renderStockKPatterns(candle ? items[0] : null);
      fillStockDatesFromPlot();
      if (status) status.textContent = statusNote;
    } catch (err) {
      if (gen === state.stockChartGen && status) {
        status.textContent = err.message || "讀取失敗";
        renderStockKPatterns(null);
      }
    }
  }

  function barOhlc(b) {
    if (!b) return null;
    const c = Number(b.c);
    if (!isFinite(c)) return null;
    const o = isFinite(b.o) ? Number(b.o) : c;
    const h = isFinite(b.h) ? Number(b.h) : Math.max(o, c);
    const l = isFinite(b.l) ? Number(b.l) : Math.min(o, c);
    return { o: o, h: Math.max(h, o, c), l: Math.min(l, o, c), c: c };
  }

  function buildPlot(items, mode, align) {
    const series = items.map(function (item) {
      const first = item.bars[0].c;
      const last = item.bars[item.bars.length - 1].c;
      const priceMap = new Map(item.bars.map(function (b) { return [b.t.slice(0, 10), b.c]; }));
      const ohlcMap = new Map(item.bars.map(function (b) { return [b.t.slice(0, 10), barOhlc(b)]; }));
      return {
        name: item.name,
        color: item.color,
        bars: item.bars,
        change: first ? last / first - 1 : 0,
        last: last,
        isTw: item.name === "台股",
        map: new Map(item.bars.map(function (b) {
          const y = mode === "pct" ? (b.c / first - 1) * 100 : b.c;
          return [b.t.slice(0, 10), y];
        })),
        priceMap: priceMap,
        ohlcMap: ohlcMap
      };
    });
    if (align === "date" && mode === "pct") {
      const days = [];
      const seen = {};
      series.forEach(function (s) {
        s.bars.forEach(function (b) {
          const d = b.t.slice(0, 10);
          if (!seen[d]) { seen[d] = true; days.push(d); }
        });
      });
      days.sort();
      series.forEach(function (s) {
        const end = s.bars[s.bars.length - 1].t.slice(0, 10);
        let carry = null;
        let priceCarry = null;
        s.values = days.map(function (d) {
          if (d > end) return null;
          if (s.map.has(d)) carry = s.map.get(d);
          return carry;
        });
        s.prices = days.map(function (d) {
          if (d > end) return null;
          if (s.priceMap.has(d)) priceCarry = s.priceMap.get(d);
          return priceCarry;
        });
        s.ohlc = days.map(function (d) {
          if (d > end) return null;
          return s.ohlcMap.has(d) ? s.ohlcMap.get(d) : null;
        });
      });
      return { axis: days, series: series, mode: mode };
    }
    const max = Math.max.apply(null, series.map(function (s) { return s.bars.length; }));
    const longest = series.slice().sort(function (a, b) { return b.bars.length - a.bars.length; })[0];
    series.forEach(function (s) {
      const pad = max - s.bars.length;
      const values = new Array(max).fill(null);
      const prices = new Array(max).fill(null);
      const ohlc = new Array(max).fill(null);
      s.bars.forEach(function (b, i) {
        const y = mode === "pct" ? (b.c / s.bars[0].c - 1) * 100 : b.c;
        values[pad + i] = y;
        prices[pad + i] = b.c;
        ohlc[pad + i] = barOhlc(b);
      });
      s.values = values;
      s.prices = prices;
      s.ohlc = ohlc;
    });
    const axis = new Array(max).fill("");
    longest.bars.forEach(function (b, i) {
      axis[(max - longest.bars.length) + i] = b.t.slice(0, 16);
    });
    return { axis: axis, series: series, mode: mode };
  }

  function drawCandles(ctx, s, xOf, yOf, n) {
    const slot = n <= 1 ? 10 : Math.abs(xOf(Math.min(1, n - 1)) - xOf(0));
    const w = Math.max(3, Math.min(14, slot * 0.72));
    let prevC = null;
    // 台股五分 K 常開＝高＝低＝收，補前收當影線並畫收盤連線，才看得到走勢
    (s.ohlc || []).forEach(function (bar, i) {
      if (!bar) return;
      let o = bar.o;
      let h = bar.h;
      let l = bar.l;
      const c = bar.c;
      if (Math.abs(h - l) < 1e-9 && prevC != null && Math.abs(prevC - c) > 1e-9) {
        o = prevC;
        h = Math.max(prevC, c);
        l = Math.min(prevC, c);
      }
      const up = c >= o;
      const color = up ? "#ff1f1f" : "#3dbe7a";
      const x = xOf(i);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, Math.min(2.5, w * 0.22));
      ctx.beginPath();
      ctx.moveTo(x, yOf(h));
      ctx.lineTo(x, yOf(l));
      ctx.stroke();
      const y1 = yOf(Math.max(o, c));
      const y2 = yOf(Math.min(o, c));
      let bh = y2 - y1;
      ctx.fillStyle = color;
      if (bh < 2.5) {
        const mid = (y1 + y2) / 2;
        bh = 2.5;
        ctx.fillRect(x - w / 2, mid - bh / 2, w, bh);
      } else {
        ctx.fillRect(x - w / 2, y1, w, bh);
      }
      prevC = c;
    });
    ctx.beginPath();
    ctx.strokeStyle = "rgba(231, 238, 246, 0.45)";
    ctx.lineWidth = 1.25;
    let open = false;
    (s.ohlc || []).forEach(function (bar, i) {
      if (!bar) { open = false; return; }
      const x = xOf(i);
      const y = yOf(bar.c);
      if (!open) { ctx.moveTo(x, y); open = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function syncChartDetailsUi() {
    const view = $("view-chart");
    const btn = $("chart-detail-toggle");
    const details = $("chart-details");
    if (view) view.classList.toggle("chart-compact", !chartDetailsOn);
    if (btn) {
      btn.setAttribute("aria-pressed", chartDetailsOn ? "true" : "false");
      btn.setAttribute("aria-expanded", chartDetailsOn ? "true" : "false");
      const label = btn.querySelector(".chart-fold-label");
      const chev = btn.querySelector(".chart-fold-chevron");
      if (label) label.textContent = chartDetailsOn ? "走勢資訊" : "展開資訊";
      if (chev) chev.textContent = chartDetailsOn ? "▾" : "▸";
    }
    if (details) details.hidden = !chartDetailsOn;
  }

  function syncStockDetailsUi() {
    const view = $("view-stock");
    const btn = $("stock-detail-toggle");
    const details = $("stock-chart-details");
    const extra = $("stock-detail");
    const mops = $("stock-mops");
    if (view) view.classList.toggle("chart-compact", !stockDetailsOn);
    if (btn) {
      btn.setAttribute("aria-pressed", stockDetailsOn ? "true" : "false");
      btn.textContent = stockDetailsOn ? "細部資料" : "顯示細部";
    }
    if (details) details.hidden = !stockDetailsOn;
    [extra, mops].forEach(function (el) {
      if (!el) return;
      if (!stockDetailsOn) el.classList.add("chart-details-collapsed");
      else el.classList.remove("chart-details-collapsed");
    });
  }

  function drawOn(canvas, plot, opts) {
    opts = opts || {};
    if (!canvas || !plot) return;
    const cost = opts.costLines || null;
    const sel = opts.sel || null;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 260;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const left = 52;
    const right = 22;
    const top = 16;
    const bottom = 28;
    const iw = width - left - right;
    const ih = height - top - bottom;
    const candle = plot.style === "candle";
    let min = Infinity;
    let max = -Infinity;
    plot.series.forEach(function (s) {
      if (candle && s.ohlc) {
        let prevC = null;
        s.ohlc.forEach(function (bar) {
          if (!bar) return;
          let h = bar.h;
          let l = bar.l;
          if (Math.abs(h - l) < 1e-9 && prevC != null && Math.abs(prevC - bar.c) > 1e-9) {
            h = Math.max(prevC, bar.c);
            l = Math.min(prevC, bar.c);
          }
          min = Math.min(min, l, bar.c);
          max = Math.max(max, h, bar.c);
          prevC = bar.c;
        });
        return;
      }
      s.values.forEach(function (v) {
        if (v == null) return;
        min = Math.min(min, v);
        max = Math.max(max, v);
      });
    });
    if (candle && plot.mode === "price" && cost) {
      if (cost.cost20 != null) {
        min = Math.min(min, cost.cost20);
        max = Math.max(max, cost.cost20);
      }
      if (cost.cost60 != null) {
        min = Math.min(min, cost.cost60);
        max = Math.max(max, cost.cost60);
      }
    }
    if (!isFinite(min) || !isFinite(max)) return;
    if (plot.mode === "pct") { min = Math.min(min, 0); max = Math.max(max, 0); }
    const pad = (max - min) * 0.08 || 1;
    min -= pad;
    max += pad;
    const yOf = function (v) { return top + (max - v) / (max - min) * ih; };
    const xOf = function (i) {
      const n = plot.axis.length;
      return left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    };
    const axisFont = '12px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
    ctx.strokeStyle = "#2c3846";
    ctx.fillStyle = "#93a0b0";
    ctx.font = axisFont;
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const v = min + (max - min) * (g / 4);
      const y = yOf(v);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(width - right, y);
      ctx.stroke();
      const label = plot.mode === "pct" ? v.toFixed(1) + "%" : fmt(v);
      ctx.fillText(label, 4, y + 4);
    }
    if (plot.mode === "pct") {
      ctx.strokeStyle = "#8d97a6";
      ctx.beginPath();
      ctx.moveTo(left, yOf(0));
      ctx.lineTo(width - right, yOf(0));
      ctx.stroke();
    }
    if (candle) {
      plot.series.forEach(function (s) {
        drawCandles(ctx, s, xOf, yOf, plot.axis.length);
      });
      if (sel && sel.from != null && sel.to != null && plot.axis.length) {
        const a = Math.max(0, Math.min(sel.from, sel.to));
        const b = Math.min(plot.axis.length - 1, Math.max(sel.from, sel.to));
        const x1 = xOf(a);
        const x2 = xOf(b);
        const slot = plot.axis.length <= 1 ? 10 : iw / (plot.axis.length - 1);
        const padX = Math.max(4, slot * 0.4);
        ctx.fillStyle = "rgba(255, 60, 60, 0.12)";
        ctx.strokeStyle = "#ff4d4d";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(Math.min(x1, x2) - padX, top, Math.abs(x2 - x1) + padX * 2, ih);
        ctx.fill();
        ctx.stroke();
      }
    } else {
      plot.series.forEach(function (s) {
        ctx.beginPath();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        let open = false;
        let lastX = null;
        let lastY = null;
        s.values.forEach(function (v, i) {
          if (v == null) { open = false; return; }
          const x = xOf(i);
          const y = yOf(v);
          if (!open) { ctx.moveTo(x, y); open = true; }
          else ctx.lineTo(x, y);
          lastX = x;
          lastY = y;
        });
        ctx.stroke();
        if (lastX != null && s.name) {
          const tag = String(s.name).charAt(0);
          ctx.font = axisFont;
          ctx.fillStyle = s.color;
          ctx.textBaseline = "middle";
          ctx.fillText(tag, lastX + 4, lastY);
          ctx.textBaseline = "alphabetic";
        }
      });
    }
    if (candle && plot.mode === "price" && cost) {
      function drawCost(val, color, tag) {
        if (val == null || !isFinite(val)) return;
        const y = yOf(val);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(width - right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.font = '11px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
        ctx.fillText(tag + " " + fmt(val), left + 4, y - 3);
      }
      drawCost(cost.cost20, "rgba(224, 161, 0, 0.85)", "主力20");
      drawCost(cost.cost60, "rgba(120, 170, 255, 0.85)", "主力60");
    }
    ctx.fillStyle = "#93a0b0";
    ctx.font = axisFont;
    const marks = [0, Math.floor((plot.axis.length - 1) / 2), plot.axis.length - 1];
    marks.forEach(function (i) {
      const text = String(plot.axis[i] || "").slice(5, 16);
      ctx.fillText(text, xOf(i) - 18, height - 8);
    });
    canvas._layout = {
      left: left,
      top: top,
      width: iw,
      height: ih,
      min: min,
      max: max,
      axis: plot.axis,
      series: plot.series,
      mode: plot.mode,
      style: plot.style || "line"
    };
  }

  function draw() {
    drawOn($("chart"), state.plot, {
      costLines: null,
      sel: state.kDrag || state.kSel
    });
  }

  function drawStock() {
    drawOn($("stock-chart"), state.stockPlot, {
      costLines: stockChipCostLines,
      sel: state.stockKDrag || state.stockKSel
    });
  }

  function renderKPatterns(item) {
    const box = $("k-patterns");
    const hint = $("k-select-hint");
    if (hint) hint.hidden = !(item && state.chartStyle === "candle");
    if (!box) return;
    if (!item || !item.bars || !item.bars.length || !M.kPatterns) {
      box.hidden = true;
      box.innerHTML = "";
      if ($("k-pick")) { $("k-pick").hidden = true; $("k-pick").innerHTML = ""; }
      return;
    }
    const rows = M.kPatterns(item.bars).slice(0, 24);
    const catN = M.sakataCatalog ? M.sakataCatalog().length : 78;
    const ref = '<p class="fine">依<strong>酒田戰法 ' + catN +
      ' 式</strong>辨識（大陽／覆蓋／紅黑三兵／晨星夜星／三法／三山三川／三空等）。圖上可拖曳紅框解讀；點下列型態反白對應K。偏多／偏空是提示，不是下單建議。</p>';
    if (!rows.length) {
      box.hidden = false;
      box.innerHTML = "<h3>酒田K線分析</h3>" + ref + '<p class="fine">這段區間沒抓到明顯戰法型態。</p>';
      return;
    }
    box.hidden = false;
    box.innerHTML = "<h3>酒田K線分析 · " + esc(item.name) + "</h3>" + ref + "<ul>" +
      rows.map(function (row) {
        const cls = row.bias === "多" ? "up" : row.bias === "空" ? "down" : "";
        const span = /三兵|三星|夜星|晨星|三法|懷抱|覆蓋|舍子|烏雲|曙光/.test(row.name) ? 2 : 0;
        const idTag = row.id != null ? "#" + row.id + " " : "";
        return '<li data-k-focus="' + row.i + '" data-k-span="' + span + '">' +
          '<span class="k-date">' + esc(row.date.slice(5)) + "</span>" +
          '<span class="k-name ' + cls + '">' + esc(idTag + row.name) + "</span>" +
          '<span class="k-detail">' + esc(row.detail) + "</span></li>";
      }).join("") + "</ul>";
  }

  function renderStockKPatterns(item) {
    const box = $("stock-k-patterns");
    const hint = $("stock-k-select-hint");
    if (hint) hint.hidden = !(item && state.stockStyle === "candle");
    if (!box) return;
    if (!item || !item.bars || !item.bars.length || !M.kPatterns) {
      box.hidden = true;
      box.innerHTML = "";
      if ($("stock-k-pick")) { $("stock-k-pick").hidden = true; $("stock-k-pick").innerHTML = ""; }
      return;
    }
    const rows = M.kPatterns(item.bars).slice(0, 24);
    const catN = M.sakataCatalog ? M.sakataCatalog().length : 78;
    const ref = '<p class="fine">依<strong>酒田戰法 ' + catN +
      ' 式</strong>辨識。圖上可拖曳紅框解讀；點下列型態反白對應K。</p>';
    if (!rows.length) {
      box.hidden = false;
      box.innerHTML = "<h3>酒田K線分析</h3>" + ref + '<p class="fine">這段區間沒抓到明顯戰法型態。</p>';
      return;
    }
    box.hidden = false;
    box.innerHTML = "<h3>酒田K線分析 · " + esc(item.name) + "</h3>" + ref + "<ul>" +
      rows.map(function (row) {
        const cls = row.bias === "多" ? "up" : row.bias === "空" ? "down" : "";
        const span = /三兵|三星|夜星|晨星|三法|懷抱|覆蓋|舍子|烏雲|曙光/.test(row.name) ? 2 : 0;
        const idTag = row.id != null ? "#" + row.id + " " : "";
        return '<li data-stock-k-focus="' + row.i + '" data-k-span="' + span + '">' +
          '<span class="k-date">' + esc(row.date.slice(5)) + "</span>" +
          '<span class="k-name ' + cls + '">' + esc(idTag + row.name) + "</span>" +
          '<span class="k-detail">' + esc(row.detail) + "</span></li>";
      }).join("") + "</ul>";
  }

  function renderStockLegend(items) {
    const box = $("stock-legend");
    if (!box) return;
    box.innerHTML = items.map(function (item) {
      const first = item.bars[0].c;
      const last = item.bars[item.bars.length - 1].c;
      const change = first ? last / first - 1 : 0;
      return '<div><span class="swatch" style="background:' + item.color + '"></span>' + esc(item.name) +
        " " + fmt(last) + ' <span class="' + pctClass(change) + '">' + pct(change) + "</span></div>";
    }).join("");
  }

  function chartIndexAt(clientX, canvasId) {
    const canvas = $(canvasId || "chart");
    const layout = canvas && canvas._layout;
    if (!layout || !layout.axis || !layout.axis.length) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    if (x < layout.left || x > layout.left + layout.width) return null;
    const n = layout.axis.length;
    return Math.max(0, Math.min(n - 1, Math.round((x - layout.left) / layout.width * (n - 1))));
  }

  function selectedBarsFrom(plot, from, to) {
    if (!plot || !plot.series || !plot.series[0]) return [];
    const s = plot.series[0];
    const a = Math.max(0, Math.min(from, to));
    const b = Math.min((plot.axis.length || 1) - 1, Math.max(from, to));
    const out = [];
    for (let i = a; i <= b; i++) {
      const bar = s.ohlc && s.ohlc[i];
      if (!bar) continue;
      out.push({
        t: String(plot.axis[i] || ""),
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c
      });
    }
    return out;
  }

  function selectedBars(from, to) {
    return selectedBarsFrom(state.plot, from, to);
  }

  function renderKPick(report) {
    const box = $("k-pick");
    if (!box) return;
    if (!report) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const cls = /弱|賣|空/.test(report.tone) ? "down" : /多|買|升|止跌/.test(report.tone) ? "up" : "";
    const pats = (report.patterns || []).map(function (p) {
      const pc = p.bias === "多" ? "up" : p.bias === "空" ? "down" : "";
      return "<li><span class=\"" + pc + "\">" + esc(p.name) + "</span> " +
        esc((p.date || "").slice(5)) + " · " + esc(p.detail) + "</li>";
    }).join("");
    box.hidden = false;
    box.innerHTML = "<h3>框選解讀 · " + esc(report.name || "") + "</h3>" +
      "<p><span class=\"k-pick-tone " + cls + "\">" + esc(report.tone) + "</span>" +
      esc(report.from.slice(5)) + "～" + esc(report.to.slice(5)) +
      " · " + report.bars + " 根 · 開 " + fmt(report.open) + " → 收 " + fmt(report.close) +
      ' <span class="' + pctClass(report.change) + '">' + pct(report.change) + "</span>" +
      " · 高 " + fmt(report.high) + "／低 " + fmt(report.low) + "</p>" +
      "<p>" + esc(report.meaning) + "</p>" +
      (pats ? "<ul>" + pats + "</ul>" : "") +
      '<p class="fine"><button type="button" class="ghost" id="k-pick-clear">清除框選</button></p>';
  }

  function renderStockKPick(report) {
    const box = $("stock-k-pick");
    if (!box) return;
    if (!report) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const cls = /弱|賣|空/.test(report.tone) ? "down" : /多|買|升|止跌/.test(report.tone) ? "up" : "";
    const pats = (report.patterns || []).map(function (p) {
      const pc = p.bias === "多" ? "up" : p.bias === "空" ? "down" : "";
      return "<li><span class=\"" + pc + "\">" + esc(p.name) + "</span> " +
        esc((p.date || "").slice(5)) + " · " + esc(p.detail) + "</li>";
    }).join("");
    box.hidden = false;
    box.innerHTML = "<h3>框選解讀 · " + esc(report.name || "") + "</h3>" +
      "<p><span class=\"k-pick-tone " + cls + "\">" + esc(report.tone) + "</span>" +
      esc(report.from.slice(5)) + "～" + esc(report.to.slice(5)) +
      " · " + report.bars + " 根 · 開 " + fmt(report.open) + " → 收 " + fmt(report.close) +
      ' <span class="' + pctClass(report.change) + '">' + pct(report.change) + "</span>" +
      " · 高 " + fmt(report.high) + "／低 " + fmt(report.low) + "</p>" +
      "<p>" + esc(report.meaning) + "</p>" +
      (pats ? "<ul>" + pats + "</ul>" : "") +
      '<p class="fine"><button type="button" class="ghost" id="stock-k-pick-clear">清除框選</button></p>';
  }

  function applyKSelection(from, to, opts) {
    opts = opts || {};
    const plot = state.plot;
    if (!plot || plot.style !== "candle") return;
    let a = Math.min(from, to);
    let b = Math.max(from, to);
    if (a === b && !opts.exact) {
      a = Math.max(0, a - 2);
      b = Math.min(plot.axis.length - 1, b + 2);
    }
    state.kSel = { from: a, to: b };
    state.kDrag = null;
    draw();
    const bars = selectedBars(a, b);
    const name = plot.series[0] && plot.series[0].name;
    const report = M.explainKRange ? M.explainKRange(bars, name) : null;
    renderKPick(report);
    const list = $("k-patterns");
    if (list) {
      list.querySelectorAll("[data-k-focus]").forEach(function (el) {
        const i = Number(el.getAttribute("data-k-focus"));
        const span = Number(el.getAttribute("data-k-span") || 0);
        const hit = i >= a && i <= b || (span && i - span >= a && i <= b);
        el.classList.toggle("on", hit);
      });
    }
  }

  function applyStockKSelection(from, to, opts) {
    opts = opts || {};
    const plot = state.stockPlot;
    if (!plot || plot.style !== "candle") return;
    let a = Math.min(from, to);
    let b = Math.max(from, to);
    if (a === b && !opts.exact) {
      a = Math.max(0, a - 2);
      b = Math.min(plot.axis.length - 1, b + 2);
    }
    state.stockKSel = { from: a, to: b };
    state.stockKDrag = null;
    drawStock();
    const bars = selectedBarsFrom(plot, a, b);
    const name = plot.series[0] && plot.series[0].name;
    const report = M.explainKRange ? M.explainKRange(bars, name) : null;
    renderStockKPick(report);
    const list = $("stock-k-patterns");
    if (list) {
      list.querySelectorAll("[data-stock-k-focus]").forEach(function (el) {
        const i = Number(el.getAttribute("data-stock-k-focus"));
        const span = Number(el.getAttribute("data-k-span") || 0);
        const hit = i >= a && i <= b || (span && i - span >= a && i <= b);
        el.classList.toggle("on", hit);
      });
    }
  }

  function clearKSelection() {
    state.kSel = null;
    state.kDrag = null;
    renderKPick(null);
    const list = $("k-patterns");
    if (list) list.querySelectorAll("[data-k-focus].on").forEach(function (el) { el.classList.remove("on"); });
    if (state.plot && state.plot.style === "candle") draw();
  }

  function clearStockKSelection() {
    state.stockKSel = null;
    state.stockKDrag = null;
    renderStockKPick(null);
    const list = $("stock-k-patterns");
    if (list) list.querySelectorAll("[data-stock-k-focus].on").forEach(function (el) { el.classList.remove("on"); });
    if (state.stockPlot && state.stockPlot.style === "candle") drawStock();
  }

  function renderLegend(items, mode) {
    $("legend").innerHTML = items.map(function (item, idx) {
      const first = item.bars[0].c;
      const last = item.bars[item.bars.length - 1].c;
      const change = first ? last / first - 1 : 0;
      const color = item.color;
      return '<div><span class="swatch" style="background:' + color + '"></span>' + esc(item.name) +
        " " + fmt(last) + ' <span class="' + pctClass(change) + '">' + pct(change) + "</span></div>";
    }).join("");
    if (mode === "pct") {
      $("legend").insertAdjacentHTML("beforeend", '<p class="fine">數字是區間漲跌幅，起點對齊各市場自己的第一根。下方提示會顯示台股當日點數。</p>');
    }
  }

  function seriesLabel(s, i, mode, style) {
    if (style === "candle" && s.ohlc && s.ohlc[i]) {
      const bar = s.ohlc[i];
      return s.name + " 開 " + fmt(bar.o) + " 高 " + fmt(bar.h) + " 低 " + fmt(bar.l) + " 收 " + fmt(bar.c);
    }
    const v = s.values[i];
    if (v == null) return "";
    if (s.isTw) {
      const price = s.prices && s.prices[i];
      if (mode === "pct") {
        const pctText = (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
        return price != null ? "台股 " + fmt(price) + " 點（" + pctText + "）" : "台股 " + pctText;
      }
      return "台股 " + fmt(v) + " 點";
    }
    if (mode === "pct") return s.name + " " + (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
    return s.name + " " + fmt(v);
  }

  function onChartPointer(ev) {
    const canvas = $("chart");
    const layout = canvas._layout;
    const tip = $("hover");
    if (!layout || !state.plot) { tip.hidden = true; return; }
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const n = layout.axis.length;
    if (n < 1 || x < layout.left || x > layout.left + layout.width) { tip.hidden = true; return; }
    const i = Math.round((x - layout.left) / layout.width * (n - 1));
    const parts = layout.series.map(function (s) {
      return seriesLabel(s, i, layout.mode, layout.style);
    }).filter(Boolean);
    if (!parts.length) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.classList.remove("on-line");
    tip.style.left = "";
    tip.style.top = "";
    tip.style.right = "";
    tip.style.bottom = "";
    tip.textContent = (layout.axis[i] || "") + "  " + parts.join(" · ");
  }

  function fmtPx(n) {
    if (n == null || !isFinite(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1000) return Math.round(n).toLocaleString("zh-Hant");
    if (a >= 100) return n.toLocaleString("zh-Hant", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
    return n.toLocaleString("zh-Hant", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }

  function signedPx(n) {
    if (n == null || !isFinite(n)) return "—";
    return (n > 0 ? "+" : "") + fmtPx(n);
  }

  // 台股預估損益：扣賣出手續費（萬元 1.425‰、單筆最低 20）與證交稅（股票 0.3%、ETF 0.1%）
  // 買價視為券商平均成本（多半已含買進費），不再重扣買進手續費。
  const BROKER_FEE_RATE = 0.001425;
  const BROKER_FEE_MIN = 20;
  const TAX_STOCK = 0.003;
  const TAX_ETF = 0.001;

  function isEtfLike(code) {
    const c = String(code || "").trim().toUpperCase();
    if (!c) return false;
    if (/^00\d/.test(c)) return true;
    if (/[A-Z]/.test(c)) return true;
    return false;
  }

  function brokerFee(amount) {
    if (!(amount > 0)) return 0;
    return Math.max(BROKER_FEE_MIN, Math.round(amount * BROKER_FEE_RATE));
  }

  function sellTax(amount, code) {
    if (!(amount > 0)) return 0;
    return Math.round(amount * (isEtfLike(code) ? TAX_ETF : TAX_STOCK));
  }

  function watchPnl(price, cost, shares, code) {
    const p = Number(price);
    const c = Number(cost);
    const s = Number(shares);
    if (!(p > 0) || !isFinite(c) || !(s > 0)) return { text: "—", cls: "", value: null };
    const mv = p * s;
    const v = mv - c * s - brokerFee(mv) - sellTax(mv, code);
    return {
      text: (v > 0 ? "+" : "") + Math.round(v).toLocaleString("zh-Hant"),
      cls: v > 0 ? "up" : v < 0 ? "down" : "",
      value: v
    };
  }

  function paintWatchPnl(idx) {
    const box = $("watch-list");
    if (!box || isWatchMini()) return;
    const row = box.querySelector('[data-watch-row="' + idx + '"]');
    const item = book.watch[idx];
    if (!row || !item) return;
    const price = Number(row.getAttribute("data-price"));
    const pnl = watchPnl(price, item.cost, item.shares, item.code);
    const cell = row.querySelector("[data-watch-pnl]");
    if (!cell) return;
    cell.className = "watch-num watch-col-pnl" + (pnl.cls ? " " + pnl.cls : "");
    cell.textContent = pnl.text;
  }

  function paintWatchTotal() {
    const el = $("watch-total-pnl");
    if (!el) return;
    syncWatchPnlUi();
    if (!isWatchShowPnl()) return;
    const box = $("watch-list");
    if (!book.watch.length) {
      el.className = "";
      el.textContent = "—";
      return;
    }
    let sum = 0;
    let n = 0;
    book.watch.forEach(function (item, idx) {
      const row = box && box.querySelector('[data-watch-row="' + idx + '"]');
      const price = row ? Number(row.getAttribute("data-price")) : NaN;
      const pnl = watchPnl(price, item.cost, item.shares, item.code);
      if (pnl.value == null || !isFinite(pnl.value)) return;
      sum += pnl.value;
      n += 1;
    });
    if (!n) {
      el.className = "";
      el.textContent = "—";
      return;
    }
    el.className = sum > 0 ? "up" : sum < 0 ? "down" : "";
    el.textContent = (sum > 0 ? "+" : "") + Math.round(sum).toLocaleString("zh-Hant");
  }

  function watchLabel(item) {
    const name = M.preferTwName
      ? M.preferTwName(item.name, "", item.code)
      : twName(item.name || "");
    item.name = name;
    return name + (item.code || "");
  }

  function watchMiniNameHtml(item) {
    const name = M.preferTwName
      ? M.preferTwName(item.name, "", item.code)
      : twName(item.name || "");
    const title = name || String(item.code || "");
    return '<span class="watch-mini-title">' + esc(title) + "</span>";
  }

  function applyWatchQuoteRow(box, m, idx) {
    const item = book.watch[idx];
    const row = box.querySelector('[data-watch-row="' + idx + '"]');
    if (!row || !item) return;
    // 只在缺中文名時才補名稱，绝不让 Yahoo 英文覆写
    const nextName = M.preferTwName
      ? M.preferTwName(item.name, m && m.name, item.code)
      : twName(item.name || (m && m.name) || "");
    if (nextName && nextName !== item.name) {
      item.name = nextName;
      const btn = row.querySelector("[data-open-watch]");
      const nameEl = row.querySelector("[data-watch-name]");
      const label = nextName + (item.code || "");
      if (btn && !nameEl) btn.textContent = label;
      if (nameEl) {
        if (isWatchMini()) nameEl.innerHTML = watchMiniNameHtml(item);
        else nameEl.textContent = nextName || item.code || "";
      }
    }
    const priceCell = row.querySelector("[data-watch-price]");
    if (priceCell) {
      const miniPx = isWatchMini() ? " watch-mini-px" : "";
      if (m && m.price != null && isFinite(m.price)) {
        let chg = m.change;
        if ((chg == null || !isFinite(chg)) && m.pct != null && isFinite(m.pct) && m.pct !== -100) {
          chg = m.price - m.price / (1 + m.pct / 100);
        }
        const tone = chg != null && isFinite(chg) ? chg : (m.pct || 0);
        const cls = pctClass(tone);
        const chgTxt = chg != null && isFinite(chg) ? signedPx(chg) : "";
        priceCell.className = "watch-px watch-num" + miniPx + " " + cls;
        priceCell.innerHTML = fmtPx(m.price) +
          (chgTxt ? '<small class="' + cls + '">' + chgTxt + "</small>" : "");
        row.setAttribute("data-price", String(m.price));
      } else {
        priceCell.className = "watch-px watch-num" + miniPx;
        priceCell.textContent = "—";
        row.setAttribute("data-price", "");
      }
    }
    if (!isWatchMini()) paintWatchPnl(idx);
  }

  function withWatchTimeout(promise, ms, fallback) {
    return new Promise(function (resolve) {
      let done = false;
      const timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve(fallback);
      }, ms);
      Promise.resolve(promise).then(function (value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      }, function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(fallback);
      });
    });
  }

  // 先畫報價，籌碼／突支背景補；避免被慢請求卡住只顯示「…」
  async function paintWatchQuotes() {
    const box = $("watch-list");
    if (!box || !book.watch.length) return;
    if (!box.querySelector("[data-watch-row]")) {
      renderWatch(true);
      return;
    }
    const gen = (paintWatchQuotes.gen = (paintWatchQuotes.gen || 0) + 1);
    const mini = isWatchMini();
    try {
      const rows = await withWatchTimeout(M.watchBoard(book.watch), 20000, null);
      if (gen !== paintWatchQuotes.gen) return;
      if (!rows) {
        const miniPx = isWatchMini() ? " watch-mini-px" : "";
        box.querySelectorAll("[data-watch-price]").forEach(function (cell) {
          cell.className = "watch-px watch-num" + miniPx;
          cell.textContent = "—";
        });
        paintWatchTotal();
        return;
      }
      rows.forEach(function (m, idx) { applyWatchQuoteRow(box, m, idx); });
      paintWatchTotal();
      checkWatchAlertsFromRows(book.watch, rows);
      if (mini) return;
      withWatchTimeout(M.watchChips ? M.watchChips(book.watch) : Promise.resolve(null), 15000, null)
        .then(function (chips) {
          if (gen !== paintWatchQuotes.gen || !chips) return;
          paintWatchChipRows(box, chips);
        });
      withWatchTimeout(M.watchLevels ? M.watchLevels(book.watch) : Promise.resolve(null), 20000, null)
        .then(function (levels) {
          if (gen !== paintWatchQuotes.gen || !levels) return;
          paintWatchLevelRows(box, levels);
        });
    } catch (err) {
      if (gen !== paintWatchQuotes.gen) return;
      paintWatchTotal();
    }
  }

  function renderWatchMini(box) {
    box.innerHTML = '<div class="watch-mini-grid">' + book.watch.map(function (item, idx) {
      if (item.market) item.market = twName(item.market);
      const tip = watchLabel(item);
      return '<button type="button" class="watch-mini-card" data-watch-row="' + idx +
        '" data-open-watch="' + idx + '" data-price="" title="' + esc(tip) + '">' +
        '<span class="watch-mini-name" data-watch-name="' + idx + '">' + watchMiniNameHtml(item) + "</span>" +
        '<span class="watch-px watch-num watch-mini-px" data-watch-price="' + idx + '"><span class="note">…</span></span>' +
        "</button>";
    }).join("") + "</div>";
  }

  function renderWatchFull(box) {
    box.innerHTML = '<div class="watch-table-wrap"><table class="watch-table"><thead><tr>' +
      '<th>標的</th><th>目前</th><th>買價</th><th class="watch-col-pnl">損益</th><th>股數</th>' +
      '<th>籌碼</th><th>突</th><th>支</th><th></th><th>通知</th>' +
      "</tr></thead><tbody>" + book.watch.map(function (item, idx) {
        const shares = item.shares == null ? "" : item.shares;
        const cost = item.cost == null ? "" : item.cost;
        normalizeNotify(item);
        const mode = notifyModeOf(item);
        const meta = NOTIFY_MODES[mode];
        const val = notifyValOf(item);
        const valText = val == null ? "" : String(val);
        if (item.market) item.market = twName(item.market);
        const label = watchLabel(item);
        const nameOnly = (item.name || item.code || "").trim() || label;
        const modeOpts = Object.keys(NOTIFY_MODES).map(function (key) {
          return '<option value="' + key + '"' + (key === mode ? " selected" : "") + ">" +
            NOTIFY_MODES[key].label + "</option>";
        }).join("");
        return '<tr data-watch-row="' + idx + '" data-price="">' +
          '<td class="watch-name">' +
          '<button type="button" class="watch-link" data-open-watch="' + idx +
          '" title="' + esc(label) + '">' +
          '<span data-watch-name="' + idx + '">' + esc(nameOnly) + '</span></button></td>' +
          '<td class="watch-col-price">' +
          '<div class="watch-px watch-num" data-watch-price="' + idx + '"><span class="note">…</span></div></td>' +
          '<td class="watch-col-cost"><input class="watch-input" data-watch-cost="' + idx +
          '" inputmode="decimal" value="' + esc(cost) + '" placeholder="—" aria-label="買價"></td>' +
          '<td class="watch-num watch-col-pnl" data-watch-pnl="' + idx + '">—</td>' +
          '<td class="watch-col-shares"><input class="watch-input" data-watch-shares="' + idx +
          '" inputmode="numeric" value="' + esc(shares) + '" placeholder="—" aria-label="股數"></td>' +
          '<td class="watch-col-chips"><div class="watch-chips" data-watch-chips="' + idx +
          '"><span class="watch-lamp-chip" data-watch-lamp="' + idx + '"></span>' +
          '<span class="note">…</span></div></td>' +
          '<td class="watch-col-lv"><span class="watch-lv watch-lv-brk" data-watch-brk="' + idx +
          '"></span></td>' +
          '<td class="watch-col-lv"><span class="watch-lv watch-lv-sup" data-watch-sup="' + idx +
          '"></span></td>' +
          '<td class="watch-col-del"><button type="button" class="danger" data-del-watch="' + idx + '">移除</button></td>' +
          '<td class="watch-alert-cell"><div class="watch-alert">' +
          '<label class="watch-alert-toggle"><input type="checkbox" data-watch-notify="' + idx + '"' +
          (item.notify ? " checked" : "") + "> 開</label>" +
          '<select class="watch-alert-mode" data-watch-notify-mode="' + idx + '" aria-label="通知條件">' +
          modeOpts + "</select>" +
          '<label class="watch-alert-val"><span data-alert-prefix="1">' + esc(meta.prefix) + "</span>" +
          '<input data-watch-notify-val="' + idx + '" inputmode="decimal" value="' + esc(valText) +
          '" placeholder="' + (mode === "pct" ? "3" : "數值") + '" aria-label="通知門檻">' +
          '<span data-alert-suffix="1">' + esc(meta.suffix || "") + "</span>" +
          "</label></div></td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function renderWatch(force) {
    const box = $("watch-list");
    paintWatchGroups();
    if (!book.watch.length) {
      box.innerHTML = '<p class="note">這個群組還是空的。按群組列「加入股票」用代號或庫存圖新增。</p>';
      paintWatchTotal();
      return;
    }
    const mini = isWatchMini();
    // 表格／極簡卡已在且非強制重建：只刷新報價
    if (!force && box.querySelector("[data-watch-row]") &&
        !!box.querySelector(".watch-mini-grid") === mini) {
      paintWatchQuotes();
      return;
    }
    const gen = (renderWatch.gen = (renderWatch.gen || 0) + 1);
    if (mini) renderWatchMini(box);
    else renderWatchFull(box);
    withWatchTimeout(M.watchBoard(book.watch), 20000, null).then(function (rows) {
      if (gen !== renderWatch.gen) return;
      if (!rows) {
        const miniPx = isWatchMini() ? " watch-mini-px" : "";
        box.querySelectorAll("[data-watch-price]").forEach(function (cell) {
          cell.className = "watch-px watch-num" + miniPx;
          cell.textContent = "—";
        });
        paintWatchTotal();
        return;
      }
      rows.forEach(function (m, idx) { applyWatchQuoteRow(box, m, idx); });
      paintWatchTotal();
      checkWatchAlertsFromRows(book.watch, rows);
      if (mini) return;
      withWatchTimeout(M.watchChips ? M.watchChips(book.watch) : Promise.resolve({ date: "", byCode: {} }), 15000, { date: "", byCode: {} })
        .then(function (chips) {
          if (gen !== renderWatch.gen) return;
          paintWatchChipRows(box, chips || { date: "", byCode: {} });
        });
      withWatchTimeout(M.watchLevels ? M.watchLevels(book.watch) : Promise.resolve([]), 20000, [])
        .then(function (levels) {
          if (gen !== renderWatch.gen) return;
          paintWatchLevelRows(box, levels || []);
        });
    });
  }

  function chipLotsTag(n, tag) {
    if (n == null || !isFinite(n)) return "";
    const lots = Math.round(n / 1000);
    const cls = lots > 0 ? "up" : lots < 0 ? "down" : "";
    const sign = lots > 0 ? "+" : lots < 0 ? "-" : "";
    return '<span class="' + cls + '" title="' + esc(tag) + '買賣超">' + esc(tag) + sign +
      Math.abs(lots).toLocaleString("zh-Hant") + "張</span>";
  }

  function paintWatchChipRows(box, pack) {
    if (!box) return;
    const byCode = (pack && pack.byCode) || {};
    const date = pack && pack.date ? String(pack.date) : "";
    const dateLabel = date.length === 8 ? date.slice(4, 6) + "/" + date.slice(6, 8) : "";
    book.watch.forEach(function (item, idx) {
      const el = box.querySelector('[data-watch-chips="' + idx + '"]');
      if (!el) return;
      const code = String(item && item.code || "").toUpperCase();
      const row = code && byCode[code];
      if (!row) {
        el.innerHTML = '<span class="note">' + (dateLabel ? dateLabel + " 無" : "—") + "</span>";
        return;
      }
      const parts = [
        chipLotsTag(row.foreignNet, "外"),
        chipLotsTag(row.trustNet, "投"),
        chipLotsTag(row.dealerNet, "自")
      ].filter(Boolean);
      const net = row.instNet != null ? row.instNet : ((row.foreignNet || 0) + (row.trustNet || 0) + (row.dealerNet || 0));
      const lamp = C && C.chipTone ? C.chipTone(net, Math.max(Math.abs(net) * 8, 1)) : null;
      const lampHtml = lamp && lamp.label
        ? '<span class="watch-lamp-chip' + (lamp.cls ? " " + lamp.cls : "") +
          '" data-watch-lamp="' + idx + '" title="盤後法人燈號（非逐筆大單）">(' +
          esc(lamp.label) + ")</span>"
        : "";
      let chips = parts.length ? parts.join(" ") : '<span class="note">—</span>';
      if (dateLabel && parts.length) {
        chips += ' <span class="watch-chip-date">' + esc(dateLabel) + "</span>";
      }
      el.innerHTML = lampHtml + chips;
    });
  }

  function paintWatchLevelRows(box, rows) {
    if (!box) return;
    const list = rows || [];
    book.watch.forEach(function (_item, idx) {
      const lv = list[idx] || {};
      const brk = box.querySelector('[data-watch-brk="' + idx + '"]');
      const sup = box.querySelector('[data-watch-sup="' + idx + '"]');
      if (brk) {
        if (lv.breakout && lv.breakout.text) {
          brk.className = "watch-lv watch-lv-brk up";
          brk.textContent = "突" + lv.breakout.text;
          brk.title = (lv.breakout.why || "上漲突破點") + " " + lv.breakout.text;
        } else {
          brk.className = "watch-lv watch-lv-brk";
          brk.textContent = "";
          brk.removeAttribute("title");
        }
      }
      if (sup) {
        const s = lv.support;
        const label = s && (s.focusText || s.text);
        if (label) {
          sup.className = "watch-lv watch-lv-sup down";
          // 列表用單點 focusText；區間留給 title
          const short = s.focusText || String(s.text).split("–")[0];
          sup.textContent = "支" + short;
          sup.title = (s.why || "下跌支撐點") + " " + (s.text || short);
        } else {
          sup.className = "watch-lv watch-lv-sup";
          sup.textContent = "";
          sup.removeAttribute("title");
        }
      }
    });
  }

  function splitWatchQuery(raw) {
    return String(raw || "").split(/[,，、]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  async function resolveWatchToken(token) {
    const q = String(token || "").trim();
    if (!q) return null;
    let rows = [];
    try { rows = await M.search(q); } catch (err) { rows = []; }
    // 自選只接受台股，绝不回退到日股／美股
    const list = rows.filter(function (row) { return row.market === "台股"; });
    const key = q.toUpperCase();
    const exact = list.find(function (row) { return String(row.code || "").toUpperCase() === key; });
    return exact || list[0] || null;
  }

  function bindSearch(inputId, hitId, key, prefer) {
    let timer = 0;
    $(inputId).addEventListener("input", function () {
      clearTimeout(timer);
      const q = $(inputId).value.trim();
      timer = setTimeout(async function () {
        if (q.length < 1) { $(hitId).innerHTML = ""; return; }
        if (key === "watch") {
          const parts = splitWatchQuery(q);
          if (parts.length > 1) {
            $(hitId).innerHTML = '<p class="note">將一次加入 ' + parts.length +
              " 檔：" + esc(parts.join("、")) + "。可填共用買價／股數後按加入。</p>";
            return;
          }
        }
        try {
          let rows = await M.search(q);
          if (prefer) {
            // 有指定市場時一律硬過濾，沒有台股就顯示找不到（不要改秀日股）
            rows = rows.filter(function (row) { return row.market === prefer; });
          }
          $(hitId).innerHTML = rows.map(function (row) {
            return '<button type="button" class="hit" data-pick="' + key + '" data-secid="' + esc(row.secid) +
              '" data-code="' + esc(row.code) + '" data-name="' + esc(row.name) + '" data-market="' + esc(row.market) +
              '"><strong>' + esc(row.name) + "</strong> " + esc(row.code) + "<small>" + esc(row.market) + "</small></button>";
          }).join("") || '<p class="note">' + (prefer ? "找不到這個台股。" : "找不到美股、台股、日股或韓股。") + "</p>";
        } catch (err) {
          $(hitId).innerHTML = '<p class="note">' + esc(err.message || "搜尋失敗") + "</p>";
        }
      }, 250);
    });
  }

  function syncHolding(item) {
    if (item.shares === "" || item.shares == null) return;
    const hold = book.holdings.find(function (row) { return row.secid === item.secid; });
    if (hold) {
      hold.shares = item.shares;
      hold.cost = item.cost;
      hold.name = item.name;
      hold.code = item.code;
      hold.market = item.market;
      return;
    }
    book.holdings.push({
      secid: item.secid,
      code: item.code,
      name: item.name,
      market: item.market,
      shares: item.shares,
      cost: item.cost
    });
  }

  function savePosition(row) {
    const item = {
      secid: row.secid,
      code: row.code,
      name: twName(row.name),
      market: twName(row.market || ""),
      shares: row.shares == null ? "" : String(row.shares).trim(),
      cost: row.cost == null ? "" : String(row.cost).trim()
    };
    const found = book.watch.find(function (entry) { return entry.secid === item.secid; });
    if (found) {
      found.shares = item.shares;
      found.cost = item.cost;
      found.name = item.name;
      found.code = item.code;
      found.market = item.market;
    } else book.watch.push(item);
    syncHolding(found || item);
    flushWatchToGroup();
    scheduleSave();
    renderWatch(true);
  }

  function lotsText(n) {
    if (n == null || !isFinite(n)) return "—";
    const lots = n / 1000;
    const sign = lots > 0 ? "+" : "";
    return sign + lots.toFixed(0) + " 張";
  }

  function pctText(n) {
    if (n == null || !isFinite(n)) return "—";
    return n.toFixed(1) + "%";
  }

  function renderStockDetail(detail, chipx) {
    const box = $("stock-detail");
    if (!box) return;
    if (!detail) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    if (!detail.ok) {
      box.innerHTML = '<article class="card"><p class="note">' + esc(detail.reason || "沒有明細") + "</p></article>";
      return;
    }
    const q = detail.quote;
    const own = detail.ownership || {};
    const m = detail.margins || {};
    const per = detail.per;
    const quoteHtml = q
      ? '<article class="card"><h3>今日行情 ' + esc(q.date.slice(5)) + "</h3><p>收 " + fmt(q.close) +
        ' <span class="' + pctClass((q.spread || 0) / (q.close - (q.spread || 0) || 1)) + '">' +
        (q.spread > 0 ? "+" : "") + fmt(q.spread) + "</span></p><p>最高 " + fmt(q.high) + " · 最低 " + fmt(q.low) +
        " · 成交 " + (q.volume != null ? Math.round(q.volume / 1000).toLocaleString("zh-Hant") + " 張" : "—") +
        "</p></article>"
      : "";
    const chipsHtml = '<article class="card"><h3>今日籌碼日報 ' + esc((detail.chipDate || "").slice(5)) +
      '</h3><div class="chip-grid">' + (detail.chipCards || []).map(function (c) {
        return '<div class="chip-cell"><span class="tag ' + c.tone.cls + '">' + esc(c.tone.label) +
          "</span><div>" + esc(c.name) + '</div><strong class="' + (c.net > 0 ? "up" : c.net < 0 ? "down" : "") + '">' +
          lotsText(c.net) + "</strong></div>";
      }).join("") + '</div><p class="fine">依當日買賣超佔成交比重粗分大買／中買／中立／中賣／大賣。</p></article>';
    const ownHtml = '<article class="card"><h3>籌碼分佈</h3><ul class="stat-list">' +
      "<li><span>外資持股占比</span><strong>" + pctText(own.foreignPct) + "</strong></li>" +
      "<li><span>外資剩餘可投資占比</span><strong>" + pctText(own.foreignRemain) + "</strong></li>" +
      '<li><span>近 5 日外資買賣超</span><strong class="' + ((own.flow5 && own.flow5.foreign) > 0 ? "up" : "down") + '">' + lotsText(own.flow5 && own.flow5.foreign) + "</strong></li>" +
      '<li><span>近 5 日投信買賣超</span><strong class="' + ((own.flow5 && own.flow5.trust) > 0 ? "up" : "down") + '">' + lotsText(own.flow5 && own.flow5.trust) + "</strong></li>" +
      '<li><span>近 5 日自營買賣超</span><strong class="' + ((own.flow5 && own.flow5.dealer) > 0 ? "up" : "down") + '">' + lotsText(own.flow5 && own.flow5.dealer) + "</strong></li>" +
      '<li><span>近 5 日法人合計</span><strong class="' + ((own.flow5 && own.flow5.total) > 0 ? "up" : "down") + '">' + lotsText(own.flow5 && own.flow5.total) + "</strong></li>" +
      '</ul><p class="fine">持股占比目前公開資料主要是外資；投信／自營以近 5 日買賣超代表法人籌碼流向。</p></article>';
    const finHtml = '<article class="card"><h3>財務狀況（三率）</h3><ul class="stat-list">' +
      "<li><span>毛利率</span><strong>" + pctText(m.gross) + ' <span class="' + (m.grossTrend && m.grossTrend.cls) + '">' + esc(m.grossTrend && m.grossTrend.text) + "</span></strong></li>" +
      "<li><span>營益率</span><strong>" + pctText(m.op) + ' <span class="' + (m.opTrend && m.opTrend.cls) + '">' + esc(m.opTrend && m.opTrend.text) + "</span></strong></li>" +
      "<li><span>淨利率</span><strong>" + pctText(m.net) + ' <span class="' + (m.netTrend && m.netTrend.cls) + '">' + esc(m.netTrend && m.netTrend.text) + "</span></strong></li>" +
      '</ul><p class="fine">用最近一季對上一季判斷上升／下降。資料截至 ' + esc(m.date || "—") + "。</p></article>";
    const epsHtml = '<article class="card"><h3>EPS 與本益比</h3><table class="eps-table"><thead><tr><th>年</th><th>EPS</th><th>別</th></tr></thead><tbody>' +
      (detail.epsYears || []).map(function (row) {
        return "<tr><td>" + row.year + "</td><td>" + (row.eps == null ? "—" : row.eps.toFixed(2)) + "</td><td>" + esc(row.kind) + "</td></tr>";
      }).join("") + "</tbody></table><p>本益比 " + (per && per.per != null ? per.per.toFixed(2) + " 倍" : "—") +
      " · 股價淨值比 " + (per && per.pbr != null ? per.pbr.toFixed(2) : "—") +
      " · 殖利率 " + (per && per.yield != null ? per.yield.toFixed(2) + "%" : "—") +
      '</p><p class="fine">前兩年為財報季 EPS 加總；今年未滿四季會年化。後兩年依近兩年成長粗估，不是券商正式預估。</p></article>';
    const volHtml = '<article class="card"><h3>近 60 日成交張數</h3><ul class="vol-list">' +
      (detail.volumes || []).map(function (row) {
        return "<li><span>" + esc(row.date.slice(5)) + '</span><strong class="' + (row.spread > 0 ? "up" : row.spread < 0 ? "down" : "") + '">' +
          row.lots.toLocaleString("zh-Hant") + "</strong></li>";
      }).join("") + "</ul></article>";
    let healthHtml = "";
    if (chipx && chipx.ok) {
      const lights = (chipx.lights || []).map(function (L) {
        const cls = L.ok === true ? "up" : L.ok === false ? "down" : "";
        const mark = L.ok === true ? "綠" : L.ok === false ? "紅" : "灰";
        return '<li><span class="health-dot ' + cls + '">' + mark + "</span><span>" + esc(L.name) +
          "</span><strong>" + esc(L.detail) + "</strong></li>";
      }).join("");
      const broker = chipx.broker && chipx.broker.ok && chipx.broker.latest ? chipx.broker.latest : null;
      const brokerHtml = broker
        ? '<p class="fine">家數差 ' + broker.brokerDiff +
          " · 前15買超 " + Math.round(broker.buySum / 1000) + " 張 · 前15賣超 " +
          Math.round(broker.sellSum / 1000) + " 張</p>" +
          "<h4>買超前 8</h4><ul class=\"stat-list\">" +
          broker.topBuy.slice(0, 8).map(function (r) {
            return "<li><span>" + esc(r.name) + '</span><strong class="up">+' +
              Math.round(r.net / 1000).toLocaleString("zh-Hant") + " 張</strong></li>";
          }).join("") + "</ul>" +
          (broker.dayTrade && broker.dayTrade.length
            ? "<h4>隔日沖／當沖活躍</h4><ul class=\"stat-list\">" + broker.dayTrade.slice(0, 5).map(function (r) {
              return "<li><span>" + esc(r.name) + "</span><strong>買 " + Math.round(r.buy / 1000) +
                "／賣 " + Math.round(r.sell / 1000) + "</strong></li>";
            }).join("") + "</ul>"
            : "")
        : '<p class="fine">' + esc(chipx.note || "") + "</p>";
      healthHtml = '<article class="card"><h3>籌碼健檢 · ' + esc(chipx.bias) +
        ' <span class="tag ' + (chipx.tone && chipx.tone.cls || "") + '">' + esc(chipx.tone && chipx.tone.label || "") +
        "</span></h3><ul class=\"stat-list health-list\">" + lights +
        "</ul><ul class=\"stat-list\">" +
        "<li><span>主力成本 20 日</span><strong>" + (chipx.cost20 != null ? fmt(chipx.cost20) : "—") + "</strong></li>" +
        "<li><span>主力成本 60 日</span><strong>" + (chipx.cost60 != null ? fmt(chipx.cost60) : "—") + "</strong></li>" +
        "<li><span>集中度近似 5 日</span><strong>" + (chipx.conc && chipx.conc.d5 != null ? (chipx.conc.d5 * 100).toFixed(1) + "%" : "—") + "</strong></li>" +
        "</ul>" + brokerHtml + "</article>";
    }
    box.innerHTML = quoteHtml + chipsHtml + healthHtml + ownHtml + finHtml + epsHtml + volHtml;
  }

  async function loadStockDetail(row) {
    const box = $("stock-detail");
    const mopsBox = $("stock-mops");
    if (!box) return;
    if (!row) {
      stockChipCostLines = null;
      renderStockDetail(null);
      if (mopsBox) { mopsBox.hidden = true; mopsBox.innerHTML = ""; }
      return;
    }
    box.hidden = false;
    box.innerHTML = '<article class="card"><p class="status">正在讀籌碼與財務…</p></article>';
    if (mopsBox) {
      mopsBox.hidden = false;
      mopsBox.innerHTML = '<article class="card"><p class="status">正在讀公開資訊（營收／財報／股利）…</p></article>';
    }
    try {
      const detail = await M.stockDetail(row.secid, row.code);
      if (!state.stock || state.stock.secid !== row.secid) return;
      let chipx = null;
      if (C && C.analyzeChip) {
        try {
          chipx = await C.analyzeChip(row.code || M.twStockId(row.secid, row.code));
        } catch (err) { chipx = null; }
      }
      if (!state.stock || state.stock.secid !== row.secid) return;
      if (chipx && chipx.ok) {
        stockChipCostLines = { cost20: chipx.cost20, cost60: chipx.cost60 };
        if (state.stockPlot) drawStock();
      } else {
        stockChipCostLines = null;
      }
      renderStockDetail(detail, chipx);
      syncStockDetailsUi();
    } catch (err) {
      if (!state.stock || state.stock.secid !== row.secid) return;
      stockChipCostLines = null;
      box.innerHTML = '<article class="card"><p class="note">' + esc(err.message || "明細讀取失敗") + "</p></article>";
    }
    if (mopsBox && M.stockDisclose) {
      try {
        const pack = await M.stockDisclose(row.secid, row.code);
        if (!state.stock || state.stock.secid !== row.secid) return;
        renderMops(pack, mopsBox);
        syncStockDetailsUi();
      } catch (err) {
        if (!state.stock || state.stock.secid !== row.secid) return;
        mopsBox.innerHTML = '<article class="card"><p class="note">' +
          esc(err.message || "公開資訊讀取失敗") + "</p></article>";
      }
    }
  }

  function openSymbol(row) {
    if (!row) return;
    state.stock = row;
    state.stockBack = "watch";
    state.focus = null;
    state.focusFrom = null;
    state.stockRange = state.stockRange === "1d" ? "1d" : "1y";
    state.stockCustom = false;
    state.stockStyle = "candle";
    state.stockPlot = null;
    stockChipCostLines = null;
    setView("stock");
  }

  async function addFromForm() {
    const raw = ($("watch-q") && $("watch-q").value) || "";
    const parts = splitWatchQuery(raw);
    const shares = $("watch-shares").value;
    const cost = $("watch-cost").value;
    const btn = $("watch-add");
    if (btn) btn.disabled = true;
    $("watch-status").textContent = parts.length > 1 ? ("正在加入 " + parts.length + " 檔…") : "正在加入…";
    try {
      if (parts.length > 1) {
        const ok = [];
        const miss = [];
        for (let i = 0; i < parts.length; i++) {
          const hit = await resolveWatchToken(parts[i]);
          if (!hit) {
            miss.push(parts[i]);
            continue;
          }
          savePosition({
            secid: hit.secid,
            code: hit.code,
            name: hit.name,
            market: hit.market || "台股",
            shares: shares,
            cost: cost
          });
          ok.push(hit.code || parts[i]);
        }
        state.picks.watch = null;
        $("watch-pick").textContent = "可用逗號一次加入多檔，例如 2330,2308；或點搜尋結果後再加入。";
        $("watch-q").value = "";
        $("watch-shares").value = "";
        $("watch-cost").value = "";
        $("watch-hits").innerHTML = "";
        if (!ok.length) {
          $("watch-status").textContent = "找不到：" + miss.join("、");
          return;
        }
        $("watch-status").textContent = "已加入 " + ok.join("、") +
          (miss.length ? ("；找不到 " + miss.join("、")) : "");
        setWatchCompose(false);
        return;
      }

      let row = state.picks.watch;
      if (!row && parts[0]) row = await resolveWatchToken(parts[0]);
      if (!row) {
        $("watch-status").textContent = "先輸入代號（可用逗號多檔）或點一個搜尋結果。";
        return;
      }
      savePosition({
        secid: row.secid,
        code: row.code,
        name: row.name,
        market: row.market,
        shares: shares,
        cost: cost
      });
      state.picks.watch = null;
      $("watch-pick").textContent = "可用逗號一次加入多檔，例如 2330,2308；或點搜尋結果後再加入。";
      $("watch-q").value = "";
      $("watch-shares").value = "";
      $("watch-cost").value = "";
      $("watch-hits").innerHTML = "";
      $("watch-status").textContent = "已加入 " + (row.code || row.name);
      setWatchCompose(false);
    } catch (err) {
      $("watch-status").textContent = err.message || "加入失敗";
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderImport() {
    const box = $("import-box");
    if (!importRows.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = importRows.map(function (row, idx) {
      const note = row.note ? "<small>" + esc(row.note) + "</small>" : "";
      const miss = row.secid ? "" : "<small>找不到這個代號，這列會略過。</small>";
      return '<div class="item"><div><strong>' + esc(row.name || row.code) + "</strong> " + esc(row.code) +
        miss + note +
        '<div class="grid2"><input data-import-shares="' + idx + '" inputmode="numeric" value="' + esc(row.shares) + '" aria-label="股數">' +
        '<input data-import-cost="' + idx + '" inputmode="decimal" value="' + esc(row.cost) + '" aria-label="買價"></div></div></div>';
    }).join("") + '<button id="import-ok" class="primary" type="button">匯入這些持股</button>';
  }

  function commitImport() {
    let n = 0;
    importRows.forEach(function (row) {
      if (!row.secid) return;
      savePosition(row);
      n += 1;
    });
    importRows = [];
    renderImport();
    $("watch-status").textContent = n ? "已匯入 " + n + " 檔。" : "沒有可匯入的代號。";
    if (n) setWatchCompose(false);
  }

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("辨識程式載入失敗")); };
      document.head.appendChild(script);
    });
  }

  function setOcrStatus(msg) {
    if ($("watch-status")) $("watch-status").textContent = msg;
  }

  async function getOcrWorker() {
    if (ocrWorker) return ocrWorker;
    if (ocrWorkerPromise) return ocrWorkerPromise;
    ocrWorkerPromise = (async function () {
      await loadTesseract();
      setOcrStatus("辨識準備中（第一次會下載字庫）…");
      const worker = await window.Tesseract.createWorker("chi_tra+eng", 1, {
        logger: function (msg) {
          if (!msg) return;
          if (msg.status === "recognizing text") {
            setOcrStatus("辨識中 " + Math.round((msg.progress || 0) * 100) + "%");
          } else if (msg.status === "loading language traineddata") {
            setOcrStatus("下載字庫 " + Math.round((msg.progress || 0) * 100) + "%");
          } else if (msg.status) {
            setOcrStatus("辨識準備中…");
          }
        }
      });
      await worker.setParameters({
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "1"
      });
      ocrWorker = worker;
      ocrWorkerPromise = null;
      return worker;
    })();
    try {
      return await ocrWorkerPromise;
    } catch (err) {
      ocrWorkerPromise = null;
      throw err;
    }
  }

  function prepImage(file) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        // 券商截圖：略過頂部標題與底部備註／導覽，保留表格
        const top = Math.round(img.height * 0.14);
        const bottom = Math.round(img.height * 0.90);
        const cropH = Math.max(1, bottom - top);
        // 不放大圖（放大只拖慢 OCR）；最寬 1200 足夠讀表格
        const scale = Math.min(1, 1200 / Math.max(1, img.width));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(cropH * scale));
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.filter = "grayscale(1) contrast(1.28) brightness(1.04)";
        ctx.drawImage(img, 0, top, img.width, cropH, 0, 0, canvas.width, canvas.height);
        ctx.filter = "none";
        URL.revokeObjectURL(img.src);
        resolve(canvas);
      };
      img.onerror = function () { reject(new Error("這張圖讀不起來")); };
      img.src = URL.createObjectURL(file);
    });
  }

  function usefulWatchName(name) {
    let n = String(name || "").replace(/現股/g, "").replace(/[時人之]+$/g, "").trim();
    n = n.replace(/^(主動)/, "$1");
    if (/野村台灣/.test(n)) n = "主動野村台灣50";
    if (/統一台股增長/.test(n)) n = "主動統一台股增長";
    if (/統一升級/.test(n)) n = "主動統一升級50";
    if (/統一\s*FANG|FANG\+|FANG＋/i.test(n)) n = "統一FANG+";
    if (/國泰永續|永續高股息/.test(n)) n = "國泰永續高股息";
    if (/復華台灣科技|科技優息/.test(n)) n = "復華台灣科技優息";
    if (/^台達電/.test(n)) n = "台達電";
    if (/^台積電/.test(n)) n = "台積電";
    if (/^金寶/.test(n)) n = "金寶";
    if (/^吉茂/.test(n)) n = "吉茂";
    if (/^永豐金/.test(n)) n = "永豐金";
    if (/^廣達/.test(n)) n = "廣達";
    if (/^欣興/.test(n)) n = "欣興";
    if (/^智邦/.test(n)) n = "智邦";
    return n.length >= 2 && /[\u4e00-\u9fff]/.test(n) ? n : "";
  }

  async function resolveParsed(parsed) {
    const tasks = (parsed || []).map(async function (row) {
      let hit = null;
      const want = String(row.code || "").toUpperCase();
      const byName = usefulWatchName(row.name);
      try {
        const found = await M.search(row.code || byName || "");
        hit = found.find(function (item) {
          return String(item.code).toUpperCase() === want && item.market === "台股";
        }) || found.find(function (item) {
          return String(item.code).toUpperCase() === want;
        }) || null;
        if (!hit && byName) {
          hit = found.find(function (item) {
            return item.market === "台股" && (
              String(item.name || "").indexOf(byName.slice(0, 2)) >= 0 ||
              byName.indexOf(String(item.name || "").slice(0, 2)) >= 0
            );
          }) || found.find(function (item) { return item.market === "台股"; }) || null;
        }
      } catch (err) { /* 單一代號失敗就留白，讓使用者改 */ }
      if (!hit && byName && want) {
        try {
          const named = await M.search(byName);
          hit = named.find(function (item) {
            return item.market === "台股" && (
              String(item.name || "").indexOf(byName.slice(0, 2)) >= 0 ||
              byName.indexOf(String(item.name || "").slice(0, 2)) >= 0
            );
          }) || named.find(function (item) { return item.market === "台股"; }) || null;
        } catch (err) { /* 名稱備援失敗就用代號結果 */ }
      }
      const item = {
        code: hit ? hit.code : row.code,
        name: hit ? hit.name : (byName || row.code),
        secid: hit ? hit.secid : (want ? "178." + want : ""),
        market: hit ? hit.market : "台股",
        shares: row.shares,
        cost: "",
        note: ""
      };
      if (!item.secid && item.code) item.secid = "178." + String(item.code).toUpperCase();
      const costOk = row.cost > 0 && row.cost !== row.shares && row.cost < 100000;
      if (costOk) {
        item.cost = (Math.round(row.cost * 100) / 100).toFixed(2);
        item.note = row.note || "圖上成本均價";
      } else if (item.secid && (row.pct != null || row.pnl != null)) {
        try {
          const map = await M.quoteMap([item.secid]);
          const quote = map[item.secid];
          if (quote && quote.price > 0 && row.shares > 0) {
            let cost = null;
            let note = "";
            if (row.pct != null && isFinite(row.pct) && Math.abs(row.pct) < 80 && row.pct !== -100) {
              cost = quote.price / (1 + row.pct / 100);
              note = "現價 " + fmt(quote.price) + "，獲利 " + row.pct + "%，回推買價";
            } else if (row.pnl != null) {
              cost = quote.price - row.pnl / row.shares;
              note = "現價 " + fmt(quote.price) + "，損益 " + row.pnl + "，回推買價";
            }
            if (cost > 0) {
              item.cost = (Math.round(cost * 100) / 100).toFixed(2);
              item.note = note;
            }
          }
        } catch (err) { /* 沒報價就讓使用者自己填買價 */ }
      }
      if (!item.note && row.pnl != null) item.note = "圖上損益 " + row.pnl + "，請補買價";
      return item;
    });
    return Promise.all(tasks);
  }

  async function readHoldingsPaste(text) {
    setOcrStatus("正在解析貼上文字…");
    try {
      const raw = String(text || "").trim();
      if (!raw) {
        setOcrStatus("請先貼上持股明細文字。");
        return;
      }
      let parsed = M.parseHoldingsTable ? M.parseHoldingsTable(raw) : [];
      if (!parsed.length && M.parseInventory) parsed = M.parseInventory(raw);
      if (!parsed.length) {
        setOcrStatus("文字裡沒讀到商品與股數。請確認有代號或常見股名，以及股數、成本價。");
        importRows = [];
        renderImport();
        return;
      }
      const priced = parsed.filter(function (row) { return row.cost > 0; }).length;
      setOcrStatus("讀到 " + parsed.length + " 檔" +
        (priced ? "，其中 " + priced + " 檔有成本價。" : "。"));
      importRows = await resolveParsed(parsed);
      renderImport();
      setOcrStatus("確認股數與買價後按匯入。");
    } catch (err) {
      setOcrStatus(err.message || "文字解析失敗");
    }
  }

  async function readFubonHoldingsJson(file) {
    $("watch-json-btn").disabled = true;
    $("watch-status").textContent = "正在讀富邦庫存 JSON…";
    try {
      const text = await file.text();
      const parsed = M.parseFubonHoldingsJson(text).map(function (row) {
        return Object.assign({}, row, { note: row.cost > 0 ? "富邦 JSON 成本" : "" });
      });
      if (!parsed.length) {
        $("watch-status").textContent = "JSON 裡沒有可用的代號與股數。請確認是 StockJason 匯出的富邦庫存檔。";
        importRows = [];
        renderImport();
        return;
      }
      const priced = parsed.filter(function (row) { return row.cost > 0; }).length;
      $("watch-status").textContent = "讀到 " + parsed.length + " 檔" +
        (priced ? "，其中 " + priced + " 檔有成本。" : "，部分沒有成本請補買價。");
      importRows = await resolveParsed(parsed);
      renderImport();
      $("watch-status").textContent = "確認股數與買價後按匯入。JSON 只在這台裝置讀取，不會上傳。";
    } catch (err) {
      $("watch-status").textContent = err.message || "JSON 讀取失敗";
    } finally {
      $("watch-json-btn").disabled = false;
    }
  }

  async function readInventoryPhoto(file) {
    $("watch-photo-btn").disabled = true;
    setOcrStatus("正在讀圖…");
    try {
      const worker = await getOcrWorker();
      const canvas = await prepImage(file);
      setOcrStatus("辨識中…");
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      const first = await worker.recognize(canvas);
      const texts = [];
      if (first && first.data && first.data.text) texts.push(first.data.text);
      let parsed = M.parseInventory(texts.join("\n"));
      // 只在第一次讀太少時再補掃一次，避免固定跑 3 次
      if (parsed.length < 2) {
        setOcrStatus("辨識中（補強）…");
        await worker.setParameters({ tessedit_pageseg_mode: "4" });
        const second = await worker.recognize(canvas);
        if (second && second.data && second.data.text) texts.push("---PSM---\n" + second.data.text);
        parsed = M.parseInventory(texts.join("\n"));
      }
      if (!parsed.length) {
        setOcrStatus("沒讀到商品與股數。請上傳較清晰的庫存／未實現損益截圖，或改用上方搜尋。");
        importRows = [];
        renderImport();
        return;
      }
      const priced = parsed.filter(function (row) { return row.cost > 0; }).length;
      setOcrStatus(priced
        ? "讀到 " + parsed.length + " 檔，其中 " + priced + " 檔用圖上的成本均價當買價。"
        : "讀到 " + parsed.length + " 檔，正在查現價回推買價…");
      importRows = await resolveParsed(parsed);
      renderImport();
      setOcrStatus("確認股數與買價後按匯入。圖只在這台手機辨識，不會另存。");
    } catch (err) {
      setOcrStatus(err.message || "讀圖失敗");
    } finally {
      $("watch-photo-btn").disabled = false;
    }
  }

  function moneyFrom(which) {
    if (which === "news") {
      book.capital = Number($("news-capital").value) || book.capital;
      book.riskPct = Number($("news-risk").value) || book.riskPct;
    } else {
      book.capital = Number($("idea-capital").value) || book.capital;
      book.riskPct = Number($("idea-risk").value) || book.riskPct;
    }
    scheduleSave();
    return { capital: book.capital, riskPct: book.riskPct };
  }

  function ideaLimit() {
    const n = Math.floor(Number($("idea-count").value));
    const limit = Math.max(1, Math.min(20, isFinite(n) && n > 0 ? n : 5));
    $("idea-count").value = String(limit);
    return limit;
  }

  async function runIdeas() {
    const money = moneyFrom("idea");
    const limit = ideaLimit();
    $("idea-run").disabled = true;
    $("idea-status").textContent = "開始掃描…";
    $("idea-out").innerHTML = "";
    try {
      const report = await M.scan({
        market: "台股",
        limit: limit,
        capital: money.capital,
        riskPct: money.riskPct,
        onProgress: function (done, total, name) {
          $("idea-status").textContent = "正在讀 " + name + "（" + done + "/" + total + "）";
        }
      });
      $("idea-status").textContent = "掃了 " + report.scanned + " 檔，可進場 " + report.tradable + " 檔。以下是分數最高的 " + report.ideas.length + " 檔。";
      $("idea-out").innerHTML = report.ideas.map(function (item) {
        return '<article class="card"><p><span class="badge ' + (item.badge === "可進場" ? "go" : "") + '">' + esc(item.badge) +
          "</span> " + item.rank + ". " + esc(item.name) + " " + esc(item.code) + " · " + esc(item.market) + " · " + esc(item.setup) +
          "</p><p>進場 " + fmt(item.entry) + " · 停損 " + fmt(item.stop) + " · 停利 " + fmt(item.target) +
          " · 風報比 " + (item.rr || "—") + "</p><p>單筆風險約 " + fmt(item.riskCash) + "，建議股數 " + item.shares + "。</p><p>" +
          item.reasons.map(esc).join("</p><p>") + "</p><p>" + esc(item.fundamental) + "</p></article>";
      }).join("") + '<p class="fine">規則試算，不是下單建議。</p>';
    } catch (err) {
      $("idea-status").textContent = err.message || "掃描失敗";
    } finally {
      $("idea-run").disabled = false;
    }
  }

  async function runTech() {
    const pick = state.picks.tech;
    if (!pick) { $("tech-status").textContent = "先選一個標的。"; return; }
    $("tech-run").disabled = true;
    $("tech-status").textContent = "正在拆日線與週線…";
    try {
      const r = await M.technical(pick.secid);
      $("tech-status").textContent = "";
      $("tech-out").innerHTML = '<article class="card"><h3>' + esc(r.name) + " · " + esc(r.verdict) + "</h3><p>收盤 " + fmt(r.close) +
        "</p><ol>" + r.steps.map(function (step) {
          return '<li class="' + (step.pass ? "pass" : "fail") + '">' + esc(step.name) + "：" + esc(step.detail) + "</li>";
        }).join("") + "</ol><p>支撐 " + (r.supports.map(fmt).join("、") || "附近沒有擺動低點") +
        "</p><p>壓力 " + (r.resistances.map(fmt).join("、") || "附近沒有擺動高點") +
        "</p><p>" + esc(r.trend) + "</p><p>" + r.mas.map(function (m) {
          return m.name + " " + fmt(m.value) + (m.above ? "（價在之上）" : "（價在之下）");
        }).join(" · ") + "</p><p>" + esc(r.momentum) + "</p><p>" + esc(r.weekly) +
        "</p><p class=\"fine\">買進要四項都過；賣出要均線、MACD、RSI 與週線同時偏空；其餘觀望。</p></article>";
    } catch (err) {
      $("tech-status").textContent = err.message || "分析失敗";
    } finally {
      $("tech-run").disabled = false;
    }
  }

  async function runAdvise() {
    const pick = state.picks.advise;
    if (!pick) { $("advise-status").textContent = "先選一個標的（可點自選）。"; return; }
    $("advise-run").disabled = true;
    $("advise-status").textContent = "正在讀基本面、籌碼與 K 線…";
    try {
      const r = await M.stockAdvice(pick.secid, pick.code);
      if (!r.ok) {
        $("advise-status").textContent = r.reason || "無法研判";
        $("advise-out").innerHTML = "";
        return;
      }
      $("advise-status").textContent = "";
      const adviceCls = r.advice.indexOf("買") >= 0 ? "up" : r.advice.indexOf("賣") >= 0 || r.advice.indexOf("減") >= 0 ? "down" : "";
      const fundLis = (r.fund.notes || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
      const chipLis = (r.chip.notes || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
      const buyLis = (r.buyPoints || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
      const sellLis = (r.sellPoints || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
      const patLis = (r.patterns || []).slice(0, 6).map(function (p) {
        const cls = p.bias === "多" ? "up" : p.bias === "空" ? "down" : "";
        return "<li><span class=\"k-date\">" + esc((p.date || "").slice(5)) + "</span> " +
          '<strong class="' + cls + '">' + esc(p.name) + "</strong> " + esc(p.detail) + "</li>";
      }).join("");
      const techLine = r.tech
        ? "<p>技術結論 " + esc(r.tech.verdict) + " · " + esc(r.tech.momentum || "") + " · " + esc(r.tech.weekly || "") + "</p>"
        : "<p class=\"fine\">技術條件這次沒算完，改以籌碼與 K 線為主。</p>";
      $("advise-out").innerHTML = '<article class="card"><h3>' + esc(r.name) + " " + esc(r.code) +
        ' · <span class="' + adviceCls + '">' + esc(r.advice) + "</span></h3>" +
        "<p>現價 " + fmt(r.close) + (r.atr != null ? " · ATR(14) " + fmt(r.atr) : "") +
        " · 綜合分 " + esc(String(r.score)) + "</p>" + techLine +
        "<h4>基本面</h4><ul class=\"stat-list\">" + fundLis + "</ul>" +
        "<h4>籌碼面" + (r.chip.date ? "（" + esc(String(r.chip.date).slice(5)) + "）" : "") + "</h4><ul class=\"stat-list\">" + chipLis + "</ul>" +
        "<h4>K線買點</h4><ul>" + buyLis + "</ul>" +
        "<h4>K線賣點／停損</h4><ul>" + sellLis + "</ul>" +
        (patLis ? "<h4>近期型態</h4><ul>" + patLis + "</ul>" : "") +
        '<p class="fine">規則試算，不是投資建議。盤中法人買賣超可能尚未公告。</p></article>';
    } catch (err) {
      $("advise-status").textContent = err.message || "研判失敗";
    } finally {
      $("advise-run").disabled = false;
    }
  }

  async function runNews() {
    const pick = state.picks.news;
    if (!pick) { $("news-status").textContent = "先選一個標的。"; return; }
    const text = $("news-text").value.trim();
    if (!text) { $("news-status").textContent = "先貼上新聞。"; return; }
    const money = moneyFrom("news");
    $("news-run").disabled = true;
    $("news-status").textContent = "正在對照價格…";
    try {
      const r = await M.newsPlan({ secid: pick.secid, text: text, capital: money.capital, riskPct: money.riskPct });
      $("news-status").textContent = "";
      const seen = r.noTime
        ? "<p>內文沒有明確的已發生或未來時點，不把句子硬分成已反映。</p>"
        : "<p>較像已經公開：" + (r.seen.map(esc).join("；") || "沒有") + "</p><p>較像尚未完全反映：" + (r.unseen.map(esc).join("；") || "沒有") + "</p>";
      $("news-out").innerHTML = '<article class="card"><h3>' + esc(r.name) + " · 方向 " + esc(r.bias) + "</h3><p>現價 " + fmt(r.close) +
        "。短線波動區間 " + fmt(r.shortRange[0]) + "～" + fmt(r.shortRange[1]) + "（約 1.2 倍 ATR）。</p><p>較長區間 " +
        fmt(r.longRange[0]) + "～" + fmt(r.longRange[1]) + "。" + esc(r.weeklyNote) + "</p><p>" + esc(r.pricedText) + "</p>" +
        seen + "<p>" + esc(r.fundamental) + "</p><p>部位：單筆風險 " + fmt(r.riskCash) + "，停損 " + fmt(r.stop) +
        "，約 " + r.shares + " 股。失效條件：收盤跌破停損，或新聞裡的未來事項被公司否認。</p><p class=\"fine\">詞彙與波動只是估計，不是事件研究。</p></article>";
    } catch (err) {
      $("news-status").textContent = err.message || "轉換失敗";
    } finally {
      $("news-run").disabled = false;
    }
  }

  async function runTest() {
    const pick = state.picks.test;
    if (!pick) { $("test-status").textContent = "先選一個標的。"; return; }
    $("test-run").disabled = true;
    $("test-status").textContent = "正在回測…";
    try {
      const r = await M.backtest({ secid: pick.secid, strategy: $("test-strategy").value, range: $("test-range").value });
      const m = r.metrics;
      const pf = m.profitFactor == null ? "無虧損單" : m.profitFactor.toFixed(2);
      $("test-status").textContent = "";
      $("test-out").innerHTML = '<article class="card"><h3>' + esc(r.name) + "</h3><p>" + esc(r.strategy) + " · " + esc(r.rangeLabel) +
        " · " + r.bars + " 根日線。收盤價成交，未扣成本。" + (m.open ? " 最後一筆尚未平倉，不計入勝率。" : "") +
        "</p><p>交易 " + m.trades + " 筆 · 勝率 " + (m.winRate == null ? "—" : (m.winRate * 100).toFixed(1) + "%") +
        " · 獲利因子 " + pf + " · 最大回撤 " + (m.maxDD * 100).toFixed(1) + "% · 平均報酬 " + (m.avg * 100).toFixed(2) +
        "%</p><h3>改進</h3><ul>" + r.tips.map(function (tip) { return "<li>" + esc(tip) + "</li>"; }).join("") + "</ul></article>";
    } catch (err) {
      $("test-status").textContent = err.message || "回測失敗";
    } finally {
      $("test-run").disabled = false;
    }
  }

  function renderHoldings() {
    const box = $("risk-list");
    if (!book.holdings.length) {
      box.innerHTML = '<p class="note">還沒有持股。搜尋後輸入股數與成本。</p>';
      return;
    }
    box.innerHTML = book.holdings.map(function (item, idx) {
      if (item.name) item.name = twName(item.name);
      if (item.market) item.market = twName(item.market);
      return '<div class="item"><div><strong>' + esc(item.name) + "</strong> " + esc(item.code) +
        '<div class="grid2"><input data-shares="' + idx + '" inputmode="decimal" value="' + esc(item.shares) + '" aria-label="股數">' +
        '<input data-cost="' + idx + '" inputmode="decimal" value="' + esc(item.cost) + '" aria-label="成本"></div></div>' +
        '<button type="button" class="danger" data-del-hold="' + idx + '">移除</button></div>';
    }).join("");
  }

  async function runRisk() {
    $("risk-run").disabled = true;
    $("risk-status").textContent = "正在算權重與相關…";
    book.profile = $("risk-profile").value;
    scheduleSave();
    try {
      const r = await M.riskReport({ holdings: book.holdings, profile: book.profile });
      $("risk-status").textContent = "";
      const cash = r.cashFrac == null ? "beta 偏低，不必為了把跌幅壓半而大幅減碼。" :
        "若要把大盤跌 20% 時的估計跌幅壓到約 10%，可把約 " + Math.round(r.cashFrac * 100) + "% 的持股換成現金，優先減 beta 較高的部位。";
      $("risk-out").innerHTML = '<article class="card"><p>市值合計 ' + fmt(r.total) + " · 組合 beta " + r.beta.toFixed(2) +
        "（對標普500）· 大盤跌 20% 時估計約跌 " + (r.drop * 100).toFixed(1) + "%</p><table><tr><th>標的</th><th>權重</th><th>beta</th><th>未實現</th></tr>" +
        r.rows.map(function (row) {
          return "<tr><td>" + esc(row.code) + "</td><td>" + (row.weight * 100).toFixed(1) + "%</td><td>" +
            (row.beta == null ? "—" : row.beta.toFixed(2)) + "</td><td>" + (row.pnl == null ? "—" : fmt(row.pnl)) + "</td></tr>";
        }).join("") + "</table><h3>弱點</h3><ul>" + r.weak.map(function (line) { return "<li>" + esc(line) + "</li>"; }).join("") +
        "</ul><h3>再平衡</h3><ul>" + r.plan.map(function (row) {
          return "<li>" + esc(row.code) + " " + (row.from * 100).toFixed(1) + "% → " + (row.to * 100).toFixed(1) + "%</li>";
        }).join("") + "</ul>" + (r.cashLeft > 0.01 ? "<p>超過上限的部分約 " + (r.cashLeft * 100).toFixed(1) + "% 先留現金。</p>" : "") +
        "<p>" + cash + "</p><p class=\"fine\">beta 用近 180 個交易日，相關高於 0.75 才標成隱藏連動。</p></article>";
    } catch (err) {
      $("risk-status").textContent = err.message || "計算失敗";
    } finally {
      $("risk-run").disabled = false;
    }
  }

  function renderJournal() {
    const rows = book.journal.slice().sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
    $("j-list").innerHTML = rows.length ? rows.slice(0, 20).map(function (item) {
      return '<div class="item"><div><strong>' + esc(item.date) + " " + esc(item.name || item.code) + "</strong><small>" +
        esc(item.side) + (item.missed ? " · 錯過" : "") + " " + esc(item.emotion || "") + "</small></div>" +
        '<button type="button" class="danger" data-del-j="' + esc(item.id) + '">刪</button></div>';
    }).join("") : '<p class="note">還沒有交易紀錄。</p>';
  }

  function addJournal() {
    const pick = state.picks.journal;
    if (!pick) { $("j-status").textContent = "先選標的。"; return; }
    if (!$("j-date").value) { $("j-status").textContent = "先填日期。"; return; }
    book.journal.push({
      id: Date.now().toString(36),
      date: $("j-date").value,
      secid: pick.secid,
      code: pick.code,
      name: pick.name,
      side: $("j-side").value,
      entry: $("j-entry").value,
      exit: $("j-exit").value,
      qty: $("j-qty").value,
      stop: $("j-stop").value,
      emotion: $("j-emotion").value,
      missed: $("j-missed").checked,
      note: $("j-note").value.trim()
    });
    if (book.journal.length > 100) book.journal = book.journal.slice(-100);
    scheduleSave();
    $("j-note").value = "";
    $("j-missed").checked = false;
    $("j-status").textContent = "已寫入。";
    renderJournal();
  }

  function runJournal() {
    const r = M.reviewJournal(book.journal);
    $("j-status").textContent = "";
    $("j-out").innerHTML = '<article class="card"><p>最近 ' + r.sample + " 筆，其中完成進出 " + r.filled + " 筆、錯過 " + r.missed +
      " 筆。勝率 " + (r.winRate == null ? "—" : (r.winRate * 100).toFixed(0) + "%") +
      "。平均獲利 " + (r.avgWin * 100).toFixed(1) + "%，平均虧損 " + (r.avgLoss * 100).toFixed(1) +
      "%。沒寫停損 " + r.noStop + " 筆。</p><h3>行為</h3><ul>" + r.biases.map(function (line) {
        return "<li>" + esc(line) + "</li>";
      }).join("") + "</ul><h3>立刻可執行的三條</h3><ol>" + r.rules.map(function (line) {
        return "<li>" + esc(line) + "</li>";
      }).join("") + "</ol>" + (r.small ? "<p class=\"fine\">樣本不到 5 筆，規則先當起步約束。</p>" : "") + "</article>";
  }

  let lastPredict = null;

  function predictCsvText(r) {
    const lines = [
      "項目,數值",
      "標的," + r.target,
      "預測區間," + r.horizon,
      "歷史期間," + r.history,
      "資料日," + r.asOf,
      "總分," + r.score,
      "方向," + r.grade,
      "回測筆數," + r.backtest.trials,
      "方向命中率," + (r.backtest.accuracy == null ? "" : (r.backtest.accuracy * 100).toFixed(1) + "%"),
      "",
      "因子,類別,權重,分數,報酬或淨額"
    ];
    r.parts.forEach(function (p) {
      lines.push([p.label, p.group, p.weight, p.score, p.ret].join(","));
    });
    lines.push("");
    lines.push("回測日期,分數,預測,實際,後續報酬");
    (r.backtest.samples || []).forEach(function (s) {
      lines.push([s.date, s.score, s.pred, s.actual, (s.futurePct * 100).toFixed(2) + "%"].join(","));
    });
    return lines.join("\n");
  }

  async function runPredict() {
    const horizon = $("predict-horizon").value;
    const history = $("predict-history").value;
    if (horizon === "stock" && !state.picks.predict) {
      $("predict-status").textContent = "個股模式請先選標的。";
      return;
    }
    $("predict-run").disabled = true;
    $("predict-csv").hidden = true;
    $("predict-status").textContent = "正在讀國際與法人資料…";
    $("predict-out").innerHTML = "";
    try {
      const pick = state.picks.predict;
      const r = await M.twPredict({
        horizon: horizon,
        history: history,
        secid: pick && pick.secid,
        code: pick && pick.code,
        name: pick && pick.name
      });
      lastPredict = r;
      const bt = r.backtest;
      const acc = bt.accuracy == null ? "—" : (bt.accuracy * 100).toFixed(1) + "%";
      $("predict-status").textContent = "";
      $("predict-out").innerHTML = '<article class="card">' +
        "<h3>" + esc(r.target) + " · " + esc(r.grade) + "（" + esc(r.band) + "）</h3>" +
        "<p>總分 <strong>" + r.score + "</strong>／資料日 " + esc(r.asOf) +
        " · 預測 " + esc(horizon) + " · 回測 " + esc(history) + "</p>" +
        "<p>歷史方向命中 " + acc + "（僅評 |分|≥30 的交易日，共 " + bt.trials + " 筆；偏多 " +
        bt.longN + "／偏空 " + bt.shortN + "）。這是方向強弱，不是漲跌機率保證。</p>" +
        "<h3>類別分數</h3><ul>" + r.groups.map(function (g) {
          return "<li>" + esc(g.label) + "：" + g.score + "</li>";
        }).join("") + "</ul>" +
        "<h3>主要因子</h3><table><tr><th>指標</th><th>分數</th></tr>" +
        r.parts.slice(0, 12).map(function (p) {
          return "<tr><td>" + esc(p.label) + "</td><td>" + p.score + "</td></tr>";
        }).join("") + "</table>" +
        "<h3>組合條件</h3><ul>" + r.combos.map(function (line) {
          return "<li>" + esc(line) + "</li>";
        }).join("") + "</ul>" +
        "<h3>已納入（原期貨／廣度／融資）</h3><ul>" + (r.included || []).map(function (line) {
          return "<li>" + esc(line) + "</li>";
        }).join("") + "</ul>" +
        "<h3>中期參考（產業／總經）</h3><ul>" + (r.midTerm || []).map(function (line) {
          return "<li>" + esc(line) + "</li>";
        }).join("") + "</ul>" +
        "<p class=\"fine\">" + esc(r.weightsNote) +
        " CSV 可匯入 Excel；若要做 Logistic／XGBoost，請用同一份歷史因子另開 Python 訓練。</p></article>";
      $("predict-csv").hidden = false;
    } catch (err) {
      $("predict-status").textContent = err.message || "預測失敗";
    } finally {
      $("predict-run").disabled = false;
    }
  }

  function downloadPredictCsv() {
    if (!lastPredict) return;
    const blob = new Blob(["\ufeff" + predictCsvText(lastPredict)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tw-predict-" + (lastPredict.asOf || "out") + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  let lastReport = null;

  function reportSortLabel(mode) {
    return ({
      pctDown: "漲跌％由高到低",
      pctUp: "漲跌％由低到高",
      foreignBuy: "外資買賣超（買超多）",
      foreignSell: "外資買賣超（賣超多）",
      instBuy: "三大法人買賣超（買超多）",
      instSell: "三大法人買賣超（賣超多）",
      amount: "成交金額由高到低"
    })[mode] || mode;
  }

  function fmtShareNet(n) {
    if (n == null || !isFinite(n)) return "—";
    const lots = n / 1000;
    const sign = lots > 0 ? "+" : "";
    return sign + lots.toLocaleString("zh-TW", { maximumFractionDigits: 0 }) + " 張";
  }

  function fmtAmt(n) {
    if (n == null || !isFinite(n)) return "—";
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + " 億";
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(0) + " 萬";
    return n.toLocaleString("zh-TW");
  }

  function filterReportRows(rows, only) {
    return (rows || []).filter(function (row) {
      const code = String(row.code || "");
      // 4 碼且非 00xx（ETF 常見）視為一般上市股票
      const isStock = /^\d{4}$/.test(code) && !/^00/.test(code);
      if (only === "stock") return isStock;
      if (only === "etf") return !isStock;
      return true;
    });
  }

  function reportTableHtml(rows, limit, days) {
    const slice = rows.slice(0, limit);
    const multi = days > 1;
    return '<table class="report-table"><thead><tr>' +
      "<th>#</th><th>代號</th><th>名稱</th><th>收盤</th><th>" + (multi ? "區間漲跌" : "漲跌") + "</th><th>" +
      (multi ? "區間％" : "漲跌％") + "</th>" +
      "<th>" + (multi ? "外資合計" : "外資") + "</th><th>" + (multi ? "法人合計" : "三大法人") +
      "</th><th>" + (multi ? "成交合計" : "成交金額") + "</th></tr></thead><tbody>" +
      slice.map(function (row, i) {
        const cls = pctClass((row.pct || 0) / 100);
        const chg = row.change == null ? "—" :
          ((row.change > 0 ? "+" : "") + Number(row.change).toFixed(2));
        const p = row.pct == null ? "—" :
          ((row.pct > 0 ? "+" : "") + Number(row.pct).toFixed(2) + "%");
        return "<tr><td>" + (i + 1) + "</td><td>" + esc(row.code) + "</td><td>" + esc(row.name) +
          "</td><td class=\"num\">" + (row.close == null ? "—" : fmt(row.close)) +
          "</td><td class=\"num " + cls + "\">" + chg +
          "</td><td class=\"num " + cls + "\">" + p +
          "</td><td class=\"num " + pctClass(row.foreignNet || 0) + "\">" + fmtShareNet(row.foreignNet) +
          "</td><td class=\"num " + pctClass(row.instNet || 0) + "\">" + fmtShareNet(row.instNet) +
          "</td><td class=\"num\">" + fmtAmt(row.amount) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  function buildReportView(pack, mode, only, limit) {
    const filtered = filterReportRows(pack.rows, only);
    const sorted = M.sortDailyReportRows(filtered, mode);
    const twii = pack.twii;
    const days = pack.days || 1;
    const rangeLabel = days > 1
      ? (pack.startDate + "～" + pack.date + "（" + days + " 日）")
      : pack.date;
    const fundLabel = pack.fundDateFrom && pack.fundDateFrom !== pack.fundDate
      ? (pack.fundDateFrom + "～" + pack.fundDate)
      : (pack.fundDate || "尚未公告");
    const summary = '<div class="report-summary">' +
      "<div><span>行情區間</span><strong>" + esc(rangeLabel) + "</strong></div>" +
      "<div><span>法人區間</span><strong>" + esc(fundLabel) + "</strong></div>" +
      "<div><span>加權收盤</span><strong class=\"" + (twii ? pctClass((twii.pct || 0) / 100) : "") + "\">" +
      (twii && twii.close != null ? fmt(twii.close) : "—") + "</strong></div>" +
      "<div><span>" + (days > 1 ? "加權區間漲跌" : "加權漲跌") + "</span><strong class=\"" +
      (twii ? pctClass((twii.pct || 0) / 100) : "") + "\">" +
      (twii && twii.change != null
        ? ((twii.change > 0 ? "+" : "") + Number(twii.change).toFixed(2) +
          "（" + (twii.pct > 0 ? "+" : "") + Number(twii.pct).toFixed(2) + "%）")
        : "—") + "</strong></div></div>";
    return {
      sorted: sorted,
      html: '<article class="card"><h3>' + esc(reportSortLabel(mode)) +
        " · " + days + " 日 · 前 " + Math.min(limit, sorted.length) + "／" + sorted.length + " 檔</h3>" +
        summary + reportTableHtml(sorted, limit, days) +
        '<p class="fine">來源：證交所 MI_INDEX、T86。區間漲跌＝迄日收盤相對區間首日收盤；買賣超／成交為區間加總（張＝千股）。</p></article>'
    };
  }

  function reportStandaloneHtml(pack, mode, only, limit) {
    const view = buildReportView(pack, mode, only, limit);
    return "<!DOCTYPE html><html lang=\"zh-Hant\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
      "<title>盤後報表 " + esc(pack.date) + " " + (pack.days || 1) + "日</title>" +
      "<style>body{font-family:\"Noto Sans TC\",\"Microsoft JhengHei\",sans-serif;background:#10151b;color:#e7eef6;margin:16px}" +
      "table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #2c3846;padding:6px 4px;text-align:left}" +
      "td.num{text-align:right}.up{color:#ff6b6b}.down{color:#3dbe7a}h1{font-size:20px}" +
      ".fine{color:#93a0b0;font-size:12px}.summary{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}" +
      ".summary div{background:#1a222c;border-radius:8px;padding:8px 10px}</style></head><body>" +
      "<h1>三生有杏 · 盤後排序報表</h1>" +
      "<p class=\"fine\">" + esc(reportSortLabel(mode)) + " · " + (pack.days || 1) + " 日 · 行情 " +
      esc(pack.startDate || pack.date) + "～" + esc(pack.date) +
      " · 法人 " + esc(pack.fundDate || "尚未公告") + "</p>" + view.html +
      "</body></html>";
  }

  async function runReport() {
    const dateVal = ($("report-date").value || "").replace(/-/g, "");
    const days = Number($("report-range").value) || 1;
    const mode = $("report-sort").value || "pctDown";
    const only = $("report-only").value || "stock";
    const limit = Math.max(20, Math.min(500, Number($("report-limit").value) || 50));
    $("report-run").disabled = true;
    $("report-html").hidden = true;
    $("report-status").textContent = days > 1
      ? "正在讀最近 " + days + " 個交易日（較久，請稍候）…"
      : "正在讀證交所收盤與法人買賣超…";
    $("report-out").innerHTML = "";
    try {
      const pack = await M.twseDailyReport({
        date: dateVal,
        days: days,
        onProgress: function (p) {
          if (!p) return;
          if (p.phase === "mi") {
            $("report-status").textContent = "讀收盤行情 " + (p.done || 0) + "／" + (p.need || days) +
              (p.date ? "（" + p.date + "）" : "");
          } else if (p.phase === "fund") {
            $("report-status").textContent = "讀法人買賣超 " + (p.done || 0) + "／" + (p.need || days);
          }
        }
      });
      lastReport = pack;
      const view = buildReportView(pack, mode, only, limit);
      $("report-out").innerHTML = view.html;
      $("report-status").textContent = "已產生 " + (pack.startDate || pack.date) + "～" + pack.date +
        "（" + pack.days + " 日）報表。";
      $("report-html").hidden = false;
    } catch (err) {
      $("report-status").textContent = err.message || "報表產生失敗";
    } finally {
      $("report-run").disabled = false;
    }
  }

  function downloadReportHtml() {
    if (!lastReport) return;
    const mode = $("report-sort").value || "pctDown";
    const only = $("report-only").value || "stock";
    const limit = Math.max(20, Math.min(500, Number($("report-limit").value) || 50));
    const blob = new Blob([reportStandaloneHtml(lastReport, mode, only, limit)], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "twse-report-" + lastReport.date + "-" + (lastReport.days || 1) + "d.html";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function onPick(btn) {
    const row = {
      secid: btn.getAttribute("data-secid"),
      code: btn.getAttribute("data-code"),
      name: twName(btn.getAttribute("data-name")),
      market: twName(btn.getAttribute("data-market"))
    };
    const key = btn.getAttribute("data-pick");
    if (key === "watch") {
      state.picks.watch = row;
      $("watch-pick").textContent = row.name + " " + row.code + " · 填好買價與股數後按加入";
      $("watch-hits").innerHTML = "";
      $("watch-q").value = row.code + " " + row.name;
      $("watch-cost").focus();
      return;
    }
    if (key === "risk") {
      if (!book.holdings.some(function (item) { return item.secid === row.secid; })) {
        book.holdings.push(Object.assign({ shares: 1, cost: "" }, row));
        scheduleSave();
      }
      renderHoldings();
      $("risk-hits").innerHTML = "";
      return;
    }
    state.picks[key] = row;
    const label = $({
      tech: "tech-pick",
      news: "news-pick",
      test: "test-pick",
      journal: "j-pick",
      predict: "predict-pick",
      advise: "advise-pick",
      chipx: "chipx-pick",
      mops: "mops-pick"
    }[key]);
    if (label) label.textContent = row.name + " " + row.code + " · " + row.market;
    const hits = {
      tech: "tech-hits",
      news: "news-hits",
      test: "test-hits",
      journal: "j-hits",
      predict: "predict-hits",
      advise: "advise-hits",
      chipx: "chipx-hits",
      mops: "mops-hits"
    }[key];
    if (hits) $(hits).innerHTML = "";
    if (key === "chipx" && $("chipx-q")) $("chipx-q").value = row.code + " " + row.name;
    if (key === "mops" && $("mops-q")) $("mops-q").value = row.code + " " + row.name;
  }

  document.addEventListener("click", function (ev) {
    const focusLi = ev.target.closest("[data-k-focus]");
    if (focusLi && $("k-patterns") && $("k-patterns").contains(focusLi)) {
      const i = Number(focusLi.getAttribute("data-k-focus"));
      const span = Number(focusLi.getAttribute("data-k-span") || 0);
      if (isFinite(i)) applyKSelection(Math.max(0, i - span), i, { exact: true });
      return;
    }
    const stockFocusLi = ev.target.closest("[data-stock-k-focus]");
    if (stockFocusLi && $("stock-k-patterns") && $("stock-k-patterns").contains(stockFocusLi)) {
      const i = Number(stockFocusLi.getAttribute("data-stock-k-focus"));
      const span = Number(stockFocusLi.getAttribute("data-k-span") || 0);
      if (isFinite(i)) applyStockKSelection(Math.max(0, i - span), i, { exact: true });
      return;
    }
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.dataset.pick) onPick(t);
    else if (t.id === "k-pick-clear") clearKSelection();
    else if (t.id === "stock-k-pick-clear") clearStockKSelection();
    else if (t.dataset.toolWatchGroup) {
      toolWatchGroupId = t.dataset.toolWatchGroup;
      paintToolWatchPick(t.dataset.toolWatchFor || state.tool || "");
    } else if (t.dataset.toolWatchItem) {
      const g = toolWatchActiveGroup();
      const idx = Number(t.dataset.toolWatchIdx);
      const item = g && g.items ? g.items[idx] : null;
      applyToolWatchItem(t.dataset.toolWatchItem, item);
    } else if (t.dataset.range) {
      state.range = t.dataset.range;
      state.custom = false;
      if (state.range === "1d") {
        const day = isoToday();
        state.from = day;
        state.to = day;
        state.chartStyle = "candle";
        syncDateInputs();
      }
      buildToggles();
      loadChart();
    } else if (t.dataset.stockRange) {
      state.stockRange = t.dataset.stockRange;
      state.stockCustom = false;
      if (state.stockRange === "1d") {
        const day = isoToday();
        state.stockDateFrom = day;
        state.stockDateTo = day;
        state.stockStyle = "candle";
        syncStockDateInputs();
      }
      buildStockToggles();
      loadStockChart();
    } else if (t.dataset.market) {
      state.on[t.dataset.market] = t.getAttribute("aria-pressed") !== "true";
      buildToggles();
      loadChart();
    } else if (t.dataset.chartStyle) {
      setChartStyle(t.dataset.chartStyle);
      loadChart();
    } else if (t.dataset.stockStyle) {
      setStockStyle(t.dataset.stockStyle);
      loadStockChart();
    } else if (t.id === "chart-detail-toggle") {
      chartDetailsOn = !chartDetailsOn;
      syncChartDetailsUi();
    } else if (t.id === "stock-detail-toggle") {
      stockDetailsOn = !stockDetailsOn;
      syncStockDetailsUi();
    } else if (t.dataset.view) setView(t.dataset.view);
    else if (t.dataset.tool) openTool(t.dataset.tool);
    else if (t.dataset.openWatch != null) openSymbol(book.watch[Number(t.dataset.openWatch)]);
    else if (t.id === "watch-open-add") setWatchCompose(true);
    else if (t.id === "watch-compose-back") setWatchCompose(false);
    else if (t.id === "watch-add") addFromForm();
    else if (t.id === "watch-photo-btn") $("watch-photo").click();
    else if (t.id === "watch-json-btn") $("watch-json").click();
    else if (t.id === "watch-paste-btn") readHoldingsPaste($("watch-paste") && $("watch-paste").value);
    else if (t.id === "watch-mode-toggle") toggleWatchMode();
    else if (t.id === "watch-group-add") addWatchGroup();
    else if (t.id === "watch-group-rename") renameWatchGroup();
    else if (t.id === "watch-group-del") deleteWatchGroup();
    else if (t.dataset.watchGroup) switchWatchGroup(t.dataset.watchGroup);
    else if (t.id === "import-ok") commitImport();
    else if (t.dataset.delWatch != null) {
      const removed = book.watch.splice(Number(t.dataset.delWatch), 1)[0];
      if (removed) book.holdings = book.holdings.filter(function (item) { return item.secid !== removed.secid; });
      flushWatchToGroup();
      scheduleSave();
      renderWatch(true);
    } else if (t.dataset.delHold != null) {
      book.holdings.splice(Number(t.dataset.delHold), 1);
      scheduleSave();
      renderHoldings();
    } else if (t.dataset.delJ) {
      book.journal = book.journal.filter(function (item) { return item.id !== t.dataset.delJ; });
      scheduleSave();
      renderJournal();
    }
  });

  // 閘道先綁、先顯示版次，後面若掛掉仍可進站
  showVer();
  $("enter").addEventListener("click", function () { showApp(); });
  $("gate-login").addEventListener("click", doLogin);
  if (D.isEmbeddedBrowser && D.isEmbeddedBrowser()) {
    const ext = $("gate-open-browser");
    if (ext) ext.hidden = false;
    // Cursor 右側預覽：直接進站方便調版面（登入仍請用系統瀏覽器）
    if ($("gate") && !$("gate").hidden) showApp();
    if ($("who") && !D.account()) {
      $("who").textContent = "右側預覽可調版面（登入請用 Chrome）";
    }
  } else {
    const ext = $("gate-open-browser");
    if (ext) ext.hidden = true;
  }

  $("range-from").addEventListener("change", applyCustomDates);
  $("range-to").addEventListener("change", applyCustomDates);
  $("login").addEventListener("click", doLogin);
  $("logout").addEventListener("click", function () {
    D.logout();
    book = normalizeBook(JSON.parse(sessionStorage.getItem("sj-book") || "null"));
    paintChrome();
    renderWatch(true);
  });
  if ($("focus-clear")) {
    $("focus-clear").addEventListener("click", function () {
      state.focus = null;
      state.focusFrom = null;
      paintFocus();
      loadChart();
    });
  }
  if ($("stock-back")) {
    $("stock-back").addEventListener("click", function () {
      state.stock = null;
      state.stockBack = null;
      state.stockPlot = null;
      stockChipCostLines = null;
      renderStockDetail(null);
      if ($("stock-mops")) { $("stock-mops").hidden = true; $("stock-mops").innerHTML = ""; }
      setView("watch");
    });
  }
  function applyStockCustomDates() {
    const fromEl = $("stock-from");
    const toEl = $("stock-to");
    if (!fromEl || !toEl) return;
    const from = fromEl.value;
    const to = toEl.value;
    if (!from || !to) return;
    if (from > to) {
      if ($("stock-chart-status")) $("stock-chart-status").textContent = "起始日不能晚於結束日。";
      return;
    }
    state.stockCustom = true;
    state.stockDateFrom = from;
    state.stockDateTo = to;
    if (from === to) {
      state.stockRange = "1d";
      state.stockStyle = "candle";
    }
    buildStockToggles();
    loadStockChart();
  }
  if ($("stock-from")) $("stock-from").addEventListener("change", applyStockCustomDates);
  if ($("stock-to")) $("stock-to").addEventListener("change", applyStockCustomDates);
  $("idea-run").addEventListener("click", runIdeas);
  $("tech-run").addEventListener("click", runTech);
  $("advise-run").addEventListener("click", runAdvise);
  $("news-run").addEventListener("click", runNews);
  $("test-run").addEventListener("click", runTest);
  $("risk-run").addEventListener("click", runRisk);
  $("j-add").addEventListener("click", addJournal);
  $("j-run").addEventListener("click", runJournal);
  $("predict-run").addEventListener("click", runPredict);
  $("report-run").addEventListener("click", runReport);
  $("report-html").addEventListener("click", downloadReportHtml);
  $("report-sort").addEventListener("change", function () {
    if (!lastReport) return;
    const mode = $("report-sort").value || "pctDown";
    const only = $("report-only").value || "stock";
    const limit = Math.max(20, Math.min(500, Number($("report-limit").value) || 50));
    $("report-out").innerHTML = buildReportView(lastReport, mode, only, limit).html;
  });
  $("report-only").addEventListener("change", function () {
    if (!lastReport) return;
    $("report-sort").dispatchEvent(new Event("change"));
  });
  $("report-limit").addEventListener("change", function () {
    if (!lastReport) return;
    $("report-sort").dispatchEvent(new Event("change"));
  });
  $("predict-csv").addEventListener("click", downloadPredictCsv);
  $("predict-horizon").addEventListener("change", syncPredictStockBox);
  $("tool-back").addEventListener("click", function () { setView("tools"); });
  $("chart").addEventListener("pointermove", function (ev) {
    if (state.kDrag && state.plot && state.plot.style === "candle") {
      const i = chartIndexAt(ev.clientX);
      if (i != null) {
        state.kDrag.to = i;
        draw();
      }
      return;
    }
    onChartPointer(ev);
  });
  $("chart").addEventListener("pointerleave", function () { $("hover").hidden = true; });
  $("chart").addEventListener("pointerdown", function (ev) {
    if (!state.plot || state.plot.style !== "candle") return;
    const i = chartIndexAt(ev.clientX);
    if (i == null) return;
    state.kDrag = { from: i, to: i };
    try { $("chart").setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
    $("hover").hidden = true;
    draw();
    ev.preventDefault();
  });
  $("chart").addEventListener("pointerup", function (ev) {
    if (!state.kDrag) return;
    const from = state.kDrag.from;
    const to = state.kDrag.to != null ? state.kDrag.to : from;
    state.kDrag = null;
    applyKSelection(from, to);
  });
  $("chart").addEventListener("pointercancel", function () {
    state.kDrag = null;
    if (state.kSel) draw();
  });

  function onStockChartPointer(ev) {
    const canvas = $("stock-chart");
    const tip = $("stock-hover");
    if (!canvas || !tip) return;
    const layout = canvas._layout;
    if (!layout || !state.stockPlot) { tip.hidden = true; return; }
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const n = layout.axis.length;
    if (n < 1 || x < layout.left || x > layout.left + layout.width) { tip.hidden = true; return; }
    const i = Math.round((x - layout.left) / layout.width * (n - 1));
    const parts = layout.series.map(function (s) {
      return seriesLabel(s, i, layout.mode, layout.style);
    }).filter(Boolean);
    if (!parts.length) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.textContent = (layout.axis[i] || "") + "  " + parts.join(" · ");
  }

  if ($("stock-chart")) {
    $("stock-chart").addEventListener("pointermove", function (ev) {
      if (state.stockKDrag && state.stockPlot && state.stockPlot.style === "candle") {
        const i = chartIndexAt(ev.clientX, "stock-chart");
        if (i != null) {
          state.stockKDrag.to = i;
          drawStock();
        }
        return;
      }
      onStockChartPointer(ev);
    });
    $("stock-chart").addEventListener("pointerleave", function () {
      if ($("stock-hover")) $("stock-hover").hidden = true;
    });
    $("stock-chart").addEventListener("pointerdown", function (ev) {
      if (!state.stockPlot || state.stockPlot.style !== "candle") return;
      const i = chartIndexAt(ev.clientX, "stock-chart");
      if (i == null) return;
      state.stockKDrag = { from: i, to: i };
      try { $("stock-chart").setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
      if ($("stock-hover")) $("stock-hover").hidden = true;
      drawStock();
      ev.preventDefault();
    });
    $("stock-chart").addEventListener("pointerup", function () {
      if (!state.stockKDrag) return;
      const from = state.stockKDrag.from;
      const to = state.stockKDrag.to != null ? state.stockKDrag.to : from;
      state.stockKDrag = null;
      applyStockKSelection(from, to);
    });
    $("stock-chart").addEventListener("pointercancel", function () {
      state.stockKDrag = null;
      if (state.stockKSel) drawStock();
    });
  }

  function paintNotifyValChrome(idx) {
    const box = $("watch-list");
    if (!box || !book.watch[idx]) return;
    const mode = notifyModeOf(book.watch[idx]);
    const meta = NOTIFY_MODES[mode];
    const input = box.querySelector('label.watch-alert-val input[data-watch-notify-val="' + idx + '"]');
    if (!input) return;
    const wrap = input.parentElement;
    let prefix = wrap.querySelector("[data-alert-prefix]");
    let suffix = wrap.querySelector("[data-alert-suffix]");
    if (!prefix) {
      prefix = document.createElement("span");
      prefix.setAttribute("data-alert-prefix", "1");
      wrap.insertBefore(prefix, input);
    }
    if (!suffix) {
      suffix = document.createElement("span");
      suffix.setAttribute("data-alert-suffix", "1");
      wrap.appendChild(suffix);
    }
    prefix.textContent = meta.prefix;
    suffix.textContent = meta.suffix || "";
    input.placeholder = mode === "pct" ? "3" : "數值";
  }

  $("watch-list").addEventListener("input", function (ev) {
    const shares = ev.target.getAttribute("data-watch-shares");
    const cost = ev.target.getAttribute("data-watch-cost");
    const nval = ev.target.getAttribute("data-watch-notify-val");
    const idx = shares != null ? Number(shares)
      : cost != null ? Number(cost)
        : nval != null ? Number(nval) : -1;
    if (idx < 0 || !book.watch[idx]) return;
    if (shares != null) book.watch[idx].shares = ev.target.value;
    if (cost != null) book.watch[idx].cost = ev.target.value;
    if (nval != null) {
      const n = Number(ev.target.value);
      book.watch[idx].notifyVal = n > 0 && isFinite(n) ? n : null;
      if (notifyModeOf(book.watch[idx]) === "pct") {
        book.watch[idx].notifyPct = book.watch[idx].notifyVal || 3;
      }
      normalizeNotify(book.watch[idx]);
    }
    syncHolding(book.watch[idx]);
    if (shares != null || cost != null) {
      paintWatchPnl(idx);
      paintWatchTotal();
    }
    scheduleSave();
  });
  if ($("watch-pnl-toggle")) {
    $("watch-pnl-toggle").addEventListener("change", toggleWatchShowPnl);
  }
  $("watch-list").addEventListener("change", async function (ev) {
    const modeEl = ev.target.getAttribute("data-watch-notify-mode");
    if (modeEl != null) {
      const idx = Number(modeEl);
      if (idx < 0 || !book.watch[idx]) return;
      const next = ev.target.value;
      book.watch[idx].notifyMode = NOTIFY_MODES[next] ? next : "pct";
      if (book.watch[idx].notifyMode === "pct" && !(Number(book.watch[idx].notifyVal) > 0)) {
        book.watch[idx].notifyVal = 3;
      }
      normalizeNotify(book.watch[idx]);
      paintNotifyValChrome(idx);
      const input = $("watch-list").querySelector('[data-watch-notify-val="' + idx + '"]');
      if (input && book.watch[idx].notifyVal != null) input.value = String(book.watch[idx].notifyVal);
      scheduleSave();
      if (book.watch[idx].notify) pollWatchAlerts();
      return;
    }
    const notify = ev.target.getAttribute("data-watch-notify");
    if (notify == null) return;
    const idx = Number(notify);
    if (idx < 0 || !book.watch[idx]) return;
    if (ev.target.checked) {
      const ok = await ensureNotifyPermission();
      if (!ok) {
        ev.target.checked = false;
        book.watch[idx].notify = false;
        scheduleSave();
        return;
      }
      book.watch[idx].notify = true;
      normalizeNotify(book.watch[idx]);
      scheduleSave();
      pollWatchAlerts();
      return;
    }
    book.watch[idx].notify = false;
    scheduleSave();
  });
  $("import-box").addEventListener("input", function (ev) {
    const shares = ev.target.getAttribute("data-import-shares");
    const cost = ev.target.getAttribute("data-import-cost");
    const idx = shares != null ? Number(shares) : cost != null ? Number(cost) : -1;
    if (idx < 0 || !importRows[idx]) return;
    if (shares != null) importRows[idx].shares = ev.target.value;
    if (cost != null) importRows[idx].cost = ev.target.value;
  });
  $("watch-photo").addEventListener("change", function () {
    const file = $("watch-photo").files && $("watch-photo").files[0];
    $("watch-photo").value = "";
    if (file) readInventoryPhoto(file);
  });
  $("watch-json").addEventListener("change", function () {
    const file = $("watch-json").files && $("watch-json").files[0];
    $("watch-json").value = "";
    if (file) readFubonHoldingsJson(file);
  });
  $("risk-list").addEventListener("change", function (ev) {
    const shares = ev.target.getAttribute("data-shares");
    const cost = ev.target.getAttribute("data-cost");
    if (shares != null) book.holdings[Number(shares)].shares = ev.target.value;
    if (cost != null) book.holdings[Number(cost)].cost = ev.target.value;
    scheduleSave();
  });
  window.addEventListener("resize", function () {
    draw();
    if (state.view === "stock") drawStock();
  });

  bindSearch("watch-q", "watch-hits", "watch", "台股");
  bindSearch("tech-q", "tech-hits", "tech", "台股");
  bindSearch("news-q", "news-hits", "news", "台股");
  bindSearch("test-q", "test-hits", "test", "台股");
  bindSearch("risk-q", "risk-hits", "risk", "台股");
  bindSearch("j-q", "j-hits", "journal", "台股");
  bindSearch("predict-q", "predict-hits", "predict", "台股");
  bindSearch("advise-q", "advise-hits", "advise", "台股");
  bindSearch("chipx-q", "chipx-hits", "chipx", "台股");
  bindSearch("mops-q", "mops-hits", "mops", "台股");

  function pulsePct(n) {
    if (n == null || !isFinite(n)) return "—";
    return (n > 0 ? "+" : "") + Number(n).toFixed(2) + "%";
  }

  function pulseCls(n) {
    if (n == null || !isFinite(n) || n === 0) return "";
    return n > 0 ? "up" : "down";
  }

  function renderPulse(pack) {
    const box = $("pulse-out");
    if (!box) return;
    if (!pack || !pack.ok) {
      box.innerHTML = '<p class="note">動向資料讀不到。</p>';
      return;
    }
    const pre = pack.pre || {};
    const sess = pack.session || {};
    const chips = pack.chips || {};
    const usHtml = (pre.us || []).map(function (row) {
      return '<div class="pulse-cell"><span>' + esc(row.name) + '</span>' +
        '<strong class="' + pulseCls(row.pct) + '">' + (row.price != null ? fmt(row.price) : "—") + "</strong>" +
        '<small class="' + pulseCls(row.pct) + '">' + pulsePct(row.pct) + "</small></div>";
    }).join("");
    const night = pre.night;
    const nightHtml = night
      ? '<div class="pulse-cell wide"><span>台指期' + (night.isNight ? "夜盤" : "") +
        " · " + esc(String(night.date || "").slice(5)) + "</span>" +
        '<strong class="' + pulseCls(night.pct) + '">' + fmt(night.close) + "</strong>" +
        '<small class="' + pulseCls(night.pct) + '">' + pulsePct(night.pct) +
        (night.change != null ? "（" + (night.change > 0 ? "+" : "") + night.change.toFixed(0) + "）" : "") +
        "</small></div>"
      : '<div class="pulse-cell wide"><span>台指期夜盤</span><strong>—</strong></div>';

    const tw = sess.twii;
    const otc = sess.otc;
    const fx = sess.fx;
    const br = sess.breadth || {};
    const sessionHtml =
      '<div class="pulse-cell"><span>加權</span><strong class="' + pulseCls(tw && tw.pct) + '">' +
      (tw && tw.price != null ? fmt(tw.price) : "—") + '</strong><small class="' + pulseCls(tw && tw.pct) + '">' +
      pulsePct(tw && tw.pct) + "</small></div>" +
      '<div class="pulse-cell"><span>櫃買</span><strong class="' + pulseCls(otc && otc.pct) + '">' +
      (otc && otc.price != null ? fmt(otc.price) : "—") + '</strong><small class="' + pulseCls(otc && otc.pct) + '">' +
      pulsePct(otc && otc.pct) + "</small></div>" +
      '<div class="pulse-cell"><span>成交金額</span><strong>' +
      (sess.amountYi != null ? sess.amountYi.toFixed(0) + " 億" : "—") +
      "</strong><small>" + esc(sess.miDate ? String(sess.miDate).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") : "") +
      "</small></div>" +
      '<div class="pulse-cell"><span>漲跌家數</span><strong class="' +
      ((br.adl > 0) ? "up" : (br.adl < 0) ? "down" : "") + '">' +
      (br.up != null ? br.up : "—") + "／" + (br.down != null ? br.down : "—") +
      "</strong><small>ADL " + (br.adl != null ? ((br.adl > 0 ? "+" : "") + br.adl) : "—") + "</small></div>" +
      '<div class="pulse-cell"><span>匯率 TWD</span><strong class="' + pulseCls(fx && fx.pct) + '">' +
      (fx && fx.price != null ? Number(fx.price).toFixed(2) : "—") +
      '</strong><small class="' + pulseCls(fx && fx.pct) + '">' + pulsePct(fx && fx.pct) + "</small></div>" +
      '<div class="pulse-cell wide"><span>結構</span><strong>' + esc((sess.structure && sess.structure.note) || "—") +
      "</strong></div>";

    const chipsHtml =
      '<div class="pulse-cell"><span>外資現貨</span><strong class="' +
      pulseCls(chips.foreignSpot) + '">' +
      (chips.foreignSpotYi != null ? ((chips.foreignSpotYi > 0 ? "+" : "") + chips.foreignSpotYi.toFixed(1) + " 億") : "—") +
      "</strong></div>" +
      '<div class="pulse-cell"><span>外資期貨淨口數</span><strong class="' +
      pulseCls(chips.foreignFutNet) + '">' +
      (chips.foreignFutNet != null ? chips.foreignFutNet.toLocaleString("zh-Hant") : "—") +
      "</strong><small>" +
      (chips.foreignFutDelta != null ? ("變化 " + (chips.foreignFutDelta > 0 ? "+" : "") + chips.foreignFutDelta.toLocaleString("zh-Hant")) : "") +
      "</small></div>" +
      '<div class="pulse-cell"><span>籌碼格局</span><strong>' + esc(chips.bias || "—") +
      "</strong><small>" + esc(chips.note || "") + "</small></div>" +
      '<div class="pulse-cell"><span>融資餘額</span><strong>' +
      (chips.marginBalance != null ? Math.round(chips.marginBalance / 1e8) + " 億股" : "—") +
      "</strong><small class=\"" + pulseCls(chips.marginChg) + '">' +
      (chips.marginChg != null ? pulsePct(chips.marginChg * 100) : "") +
      " · " + esc(chips.marginBias || "") + "</small></div>" +
      '<div class="pulse-cell wide"><span>融資解讀</span><strong class="pulse-note">' +
      esc(chips.marginNote || "") + "</strong></div>";

    function foldCard(key, titleHtml, bodyHtml) {
      return '<article class="card pulse-card" data-pulse-card="' + key + '">' +
        '<button type="button" class="pulse-card-fold" data-pulse-fold="' + key +
        '" aria-expanded="true"><span class="pulse-card-title">' + titleHtml +
        '</span><span class="chart-fold-chevron" aria-hidden="true">▾</span></button>' +
        '<div class="pulse-card-body" data-pulse-body="' + key + '">' + bodyHtml + "</div></article>";
    }

    box.innerHTML =
      foldCard("pre",
        "一、盤前定調 <span class=\"tag " + ((pre.bias && pre.bias.cls) || "") + '">' +
        esc((pre.bias && pre.bias.label) || "—") + "</span>",
        '<p class="fine">' + esc(pre.tip || "") + '</p><div class="pulse-grid">' + usHtml + nightHtml + "</div>") +
      foldCard("sess", "二、盤中強弱",
        '<p class="fine">' + esc(sess.tip || "") + '</p><div class="pulse-grid">' + sessionHtml + "</div>") +
      foldCard("chips",
        "三、盤後籌碼 <span class=\"fine\">" + esc(chips.date || "") + "</span>",
        '<p class="fine">' + esc(chips.tip || "") + '</p><div class="pulse-grid">' + chipsHtml + "</div>" +
        '<p class="fine">' + esc(pack.note || "") + "</p>");
  }

  async function loadPulse() {
    const status = $("pulse-status");
    const box = $("pulse-out");
    if (!M || !M.twPulse) {
      if (status) status.textContent = "動向模組未載入。";
      return;
    }
    if (status) status.textContent = "正在讀美股、夜盤、大盤與籌碼…";
    try {
      const pack = await M.twPulse();
      renderPulse(pack);
      if (status) status.textContent = "更新完成。";
    } catch (err) {
      if (box) box.innerHTML = "";
      if (status) status.textContent = err.message || "動向讀取失敗";
    }
  }

  function syncFoldBtn(btn, open, openLabel, closedLabel) {
    if (!btn) return;
    btn.setAttribute("aria-pressed", open ? "true" : "false");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    const label = btn.querySelector(".chart-fold-label");
    const chev = btn.querySelector(".chart-fold-chevron");
    if (label) label.textContent = open ? openLabel : (closedLabel || ("展開" + openLabel));
    if (chev) chev.textContent = open ? "▾" : "▸";
  }

  function syncUsBoardFoldUi() {
    const body = $("us-board-body");
    const brief = $("us-brief");
    const rows = $("us-board-rows");
    if (body) body.hidden = !usBoardOpen;
    if (brief) brief.hidden = !usBriefOpen;
    if (rows) rows.hidden = !usRowsOpen;
    syncFoldBtn($("us-board-fold"), usBoardOpen, "美股觀察指標", "展開美股觀察");
    syncFoldBtn($("us-brief-fold"), usBriefOpen, "節奏解讀", "展開節奏解讀");
    syncFoldBtn($("us-rows-fold"), usRowsOpen, "報價一覽", "展開報價一覽");
    const briefFold = $("us-brief-fold");
    const rowsFold = $("us-rows-fold");
    if (briefFold) briefFold.hidden = !usBoardOpen;
    if (rowsFold) rowsFold.hidden = !usBoardOpen;
  }

  function renderUsBrief(brief) {
    const box = $("us-brief");
    if (!box) return;
    if (!brief) {
      box.innerHTML = "";
      return;
    }
    const biasCls = /多|開高/.test(brief.bias || "") ? "up"
      : /空|開低/.test(brief.bias || "") ? "down" : "";
    const checks = (brief.checks || []).map(function (c) {
      return '<div class="us-check"><span class="us-check-q">' + esc(c.q) +
        '</span><strong class="' + esc(c.cls || "") + '">' + esc(c.a) +
        "</strong><small>" + esc(c.detail || "") + "</small></div>";
    }).join("");
    const lines = (brief.lines || []).length
      ? "<ul>" + brief.lines.map(function (line) {
        return "<li>" + esc(line) + "</li>";
      }).join("") + "</ul>"
      : "";
    box.innerHTML = '<div class="us-bias">今日台股節奏預判 <strong class="' + biasCls + '">' +
      esc(brief.bias || "—") + "</strong></div>" +
      '<div class="us-checks">' + checks + "</div>" + lines +
      '<p class="fine">' + esc(brief.tip || "") + "</p>";
  }

  function paintUsBoardRows(pack) {
    const box = $("us-board-rows");
    if (!box) return;
    const core = (pack.rows || []).filter(function (row) { return row.core; });
    const rest = (pack.rows || []).filter(function (row) { return !row.core; });
    box.innerHTML = core.concat(rest).map(function (row) {
      const coreCls = row.core ? " us-cell-core" : "";
      if (!row.ok) {
        return '<div class="us-cell' + coreCls + '" data-us-key="' + esc(row.key || "") +
          '"><span>' + esc(row.name) + '</span><strong>—</strong></div>';
      }
      const cls = row.pct > 0 ? "up" : row.pct < 0 ? "down" : "";
      let priceTxt = fmt(row.price);
      if (row.key === "tnx" && row.price != null) priceTxt = row.price.toFixed(2) + "%";
      const pctTxt = row.pct == null ? "—" : ((row.pct > 0 ? "+" : "") + row.pct.toFixed(2) + "%");
      return '<div class="us-cell' + coreCls + '" data-us-key="' + esc(row.key || "") +
        '"><span>' + esc(row.name) + '</span><strong class="' + cls + '">' +
        priceTxt + '</strong><small class="' + cls + '">' + pctTxt + "</small></div>";
    }).join("");
  }

  async function loadUsBoard(opts) {
    const quiet = !!(opts && opts.quiet);
    const box = $("us-board-rows");
    if (!box || !C || !C.usBoard) return;
    if (usBoardBusy) return;
    usBoardBusy = true;
    if (!quiet) {
      box.innerHTML = '<span class="note">更新美股…</span>';
      if ($("us-brief")) $("us-brief").innerHTML = '<span class="note">解讀中…</span>';
    }
    try {
      const pack = await C.usBoard();
      if (state.view !== "pulse") return;
      renderUsBrief(pack.brief);
      paintUsBoardRows(pack);
    } catch (err) {
      if (!quiet) {
        box.innerHTML = '<span class="note">' + esc(err.message || "美股讀取失敗") + "</span>";
        if ($("us-brief")) $("us-brief").innerHTML = "";
      }
    } finally {
      usBoardBusy = false;
    }
  }

  function lotsShort(n) {
    if (n == null || !isFinite(n)) return "—";
    const lots = Math.round(n / 1000);
    return (lots > 0 ? "+" : "") + lots.toLocaleString("zh-Hant") + " 張";
  }

  function mopsFold(key, title, bodyHtml, open) {
    return '<article class="card pulse-card mops-card">' +
      '<button type="button" class="pulse-card-fold" data-mops-fold="' + key +
      '" aria-expanded="' + (open ? "true" : "false") + '"><span class="pulse-card-title">' + title +
      '</span><span class="chart-fold-chevron" aria-hidden="true">' + (open ? "▾" : "▸") +
      "</span></button>" +
      '<div class="pulse-card-body" data-mops-body="' + key + '"' + (open ? "" : " hidden") + ">" +
      bodyHtml + "</div></article>";
  }

  function mopsLinkRow(links) {
    if (!links) return "";
    const items = [
      ["material", "重大訊息"],
      ["revenue", "月營收"],
      ["financial", "財務報表"],
      ["ir", "法說會"],
      ["insider", "內部人／持股"],
      ["dividend", "股利／除權息"]
    ];
    return '<p class="fine mops-links">' + items.map(function (pair) {
      const href = links[pair[0]];
      if (!href) return "";
      return '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + pair[1] + "</a>";
    }).filter(Boolean).join(" · ") + "</p>";
  }

  function renderMops(pack, target) {
    const box = target || $("mops-out");
    if (!box) return;
    box.hidden = false;
    if (!pack || !pack.ok) {
      box.innerHTML = '<p class="note">' + esc((pack && pack.reason) || "查詢失敗") + "</p>";
      return;
    }
    const rev = pack.revenue || {};
    const fin = pack.financial || {};
    const div = pack.dividend || {};
    const own = pack.insider || {};
    const news = pack.news || {};
    const newsItems = news.items || [];
    const newsHtml = (newsItems.length
      ? '<ul class="news-list">' + newsItems.slice(0, 12).map(function (row) {
        const href = row.url || "#";
        return "<li><a href=\"" + esc(href) + "\" target=\"_blank\" rel=\"noopener\">" +
          esc(row.title || "（無標題）") + "</a>" +
          "<small>" + esc((row.source || "") + (row.date ? " · " + row.date : "")) +
          "</small></li>";
      }).join("") + "</ul>"
      : '<p class="note">目前沒抓到新聞標題。</p>') +
      '<p class="fine">' + esc(news.note || "") + "</p>" +
      '<p class="fine mops-links">' +
      (news.links && news.links.forum
        ? '<a href="' + esc(news.links.forum) + '" target="_blank" rel="noopener">CMoney 個股討論</a> · '
        : "") +
      (news.links && news.links.stock
        ? '<a href="' + esc(news.links.stock) + '" target="_blank" rel="noopener">CMoney 個股頁</a> · '
        : "") +
      '<a href="' + esc((news.links && news.links.noteRef) ||
        "https://www.cmoney.tw/notes/note-detail.aspx?nid=499697") +
      '" target="_blank" rel="noopener">技術分析選股筆記</a></p>';
    const revTable = (rev.rows || []).length
      ? '<div class="watch-table-wrap"><table class="watch-table"><thead><tr><th>年月</th><th>營收</th><th>MoM</th><th>YoY</th></tr></thead><tbody>' +
        rev.rows.slice(0, 12).map(function (row) {
          const mom = row.mom == null ? "—" : ((row.mom > 0 ? "+" : "") + row.mom.toFixed(1) + "%");
          const yoy = row.yoy == null ? "—" : ((row.yoy > 0 ? "+" : "") + row.yoy.toFixed(1) + "%");
          const yi = row.revenue != null ? (row.revenue / 1e8) : null;
          return "<tr><td>" + esc(String(row.year) + "/" + String(row.month).padStart(2, "0")) +
            "</td><td>" + (yi != null ? yi.toFixed(2) + " 億" : "—") +
            '</td><td class="' + pulseCls(row.mom) + '">' + mom +
            '</td><td class="' + pulseCls(row.yoy) + '">' + yoy + "</td></tr>";
        }).join("") + "</tbody></table></div>"
      : '<p class="note">' + esc(rev.note || "無營收") + "</p>";

    const finHtml = fin.ready
      ? '<ul class="stat-list">' +
        "<li><span>資料日</span><strong>" + esc(fin.date || "—") + "</strong></li>" +
        "<li><span>毛利率</span><strong>" + (fin.gross != null ? fin.gross.toFixed(1) + "%" : "—") +
        ' <span class="' + ((fin.grossTrend && fin.grossTrend.cls) || "") + '">' +
        esc((fin.grossTrend && fin.grossTrend.text) || "") + "</span></strong></li>" +
        "<li><span>營益率</span><strong>" + (fin.op != null ? fin.op.toFixed(1) + "%" : "—") +
        ' <span class="' + ((fin.opTrend && fin.opTrend.cls) || "") + '">' +
        esc((fin.opTrend && fin.opTrend.text) || "") + "</span></strong></li>" +
        "<li><span>淨利率</span><strong>" + (fin.net != null ? fin.net.toFixed(1) + "%" : "—") +
        ' <span class="' + ((fin.netTrend && fin.netTrend.cls) || "") + '">' +
        esc((fin.netTrend && fin.netTrend.text) || "") + "</span></strong></li>" +
        "<li><span>EPS</span><strong>" + (fin.eps != null ? Number(fin.eps).toFixed(2) : "—") + "</strong></li>" +
        "<li><span>負債比近似</span><strong>" + (fin.debtRatio != null ? fin.debtRatio.toFixed(1) + "%" : "—") + "</strong></li>" +
        "</ul><p class=\"fine\">" + esc(fin.note || "") + "</p>"
      : '<p class="note">' + esc(fin.note || "無財報摘要") + "</p>";

    const divHtml = (div.rows || []).length
      ? '<ul class="stat-list">' + div.rows.slice(0, 6).map(function (row) {
        return "<li><span>" + esc(String(row.year || row.date || "")) +
          "</span><strong>現金 " + (row.cash != null ? row.cash.toFixed(2) : "—") +
          " · 股票 " + (row.stock != null ? row.stock.toFixed(2) : "—") +
          "</strong><small>除息 " + esc(row.exCash || "—") + "／發放 " + esc(row.payCash || "—") + "</small></li>";
      }).join("") + "</ul><p class=\"fine\">" + esc(div.note || "") + "</p>"
      : '<p class="note">' + esc(div.note || "無股利") + "</p>";

    const ownHtml = '<ul class="stat-list">' +
      "<li><span>外資持股占比</span><strong>" +
      (own.foreignPct != null ? Number(own.foreignPct).toFixed(2) + "%" : "—") +
      "</strong><small>" + esc(own.date || "") + "</small></li>" +
      "<li><span>轉讓／質押／庫藏股</span><strong>請開 MOPS</strong></li>" +
      "</ul><p class=\"fine\">" + esc(own.note || "") + "</p>";

    box.innerHTML =
      '<h3 class="mops-stock-head">公開資訊觀測 · ' + esc(pack.stockId) + "</h3>" +
      '<p class="fine">' + esc(pack.tip || "") + "</p>" +
      mopsLinkRow(pack.links) +
      mopsFold("news", "0. 相關新聞 · CMoney／媒體", newsHtml, true) +
      mopsFold("mat", "1. 重大訊息 · 董事會／資產／訂單／異動／警示",
        '<p class="fine">查證市場傳言唯一官源。' + esc((pack.material && pack.material.note) || "") + "</p>" +
        '<p><a class="secondary" href="' + esc(pack.links.material) + '" target="_blank" rel="noopener">開啟 MOPS 重訊</a></p>',
        true) +
      mopsFold("rev", "2. 營收與自結 · 月合併營收／YoY／MoM",
        revTable + '<p class="fine">' + esc(rev.note || "") + " 自結 EPS 以重訊／MOPS 為準。</p>", true) +
      mopsFold("fin", "3. 財務報表 · 毛利／營益／EPS／負債比", finHtml, true) +
      mopsFold("ir", "4. 法說會 · 日期／直播／簡報",
        '<p class="fine">展望、新品與 CapEx 多在簡報。' + esc((pack.ir && pack.ir.note) || "") + "</p>" +
        '<p><a class="secondary" href="' + esc(pack.links.ir) + '" target="_blank" rel="noopener">開啟 MOPS 法說</a></p>',
        true) +
      mopsFold("ins", "5. 內部人籌碼 · 轉讓／質押／庫藏股",
        ownHtml + '<p><a class="secondary" href="' + esc(pack.links.insider) +
        '" target="_blank" rel="noopener">開啟 MOPS 持股／轉讓</a></p>', true) +
      mopsFold("div", "6. 除權息／股東會 · 除息日／發放日／開會通知",
        divHtml + '<p><a class="secondary" href="' + esc(pack.links.dividend) +
        '" target="_blank" rel="noopener">開啟 MOPS 股利／股東會</a></p>', true);
  }

  async function runMops() {
    if (!M || !M.stockDisclose) {
      $("mops-status").textContent = "公開資訊模組未載入。";
      return;
    }
    const pick = state.picks.mops;
    const q = ($("mops-q") && $("mops-q").value.trim()) || "";
    const code = (pick && pick.code) || (q.match(/\d{4}/) || [])[0] || q;
    if (!code) {
      $("mops-status").textContent = "先選標的或輸入代號。";
      return;
    }
    const secid = (pick && pick.secid) || ("tw." + code);
    $("mops-status").textContent = "正在讀營收／財報／股利…";
    $("mops-out").innerHTML = "";
    try {
      const pack = await M.stockDisclose(secid, code);
      renderMops(pack);
      $("mops-status").textContent = pack.ok ? "完成。" : (pack.reason || "失敗");
    } catch (err) {
      $("mops-status").textContent = err.message || "查詢失敗";
    }
  }

  async function runChipx() {
    if (!C) return;
    const pick = state.picks.chipx;
    const q = ($("chipx-q") && $("chipx-q").value.trim()) || "";
    const code = (pick && pick.code) || q;
    if (!code) {
      $("chipx-status").textContent = "先選標的或輸入代號。";
      return;
    }
    $("chipx-status").textContent = "正在健檢籌碼…";
    $("chipx-out").innerHTML = "";
    try {
      const r = await C.analyzeChip(code);
      const lights = (r.lights || []).map(function (L) {
        const cls = L.ok === true ? "up" : L.ok === false ? "down" : "";
        return "<li><span class=\"health-dot " + cls + "\">●</span><span>" + esc(L.name) +
          "</span><strong>" + esc(L.detail) + "</strong></li>";
      }).join("");
      let brokerBlock = "";
      const b = r.broker && r.broker.ok && r.broker.latest;
      if (b) {
        brokerBlock = "<h4>分點 · 家數差 " + b.brokerDiff + "</h4>" +
          "<p class=\"fine\">買超前15合計 " + lotsShort(b.buySum) + " · 賣超前15合計 " + lotsShort(b.sellSum) + "</p>" +
          "<div class=\"grid2\"><div><h4>買超前 10</h4><ul class=\"stat-list\">" +
          b.topBuy.slice(0, 10).map(function (row) {
            return "<li><span>" + esc(row.name) + '</span><strong class="up">' + lotsShort(row.net) + "</strong></li>";
          }).join("") + "</ul></div><div><h4>賣超前 10</h4><ul class=\"stat-list\">" +
          b.topSell.slice(0, 10).map(function (row) {
            return "<li><span>" + esc(row.name) + '</span><strong class="down">' + lotsShort(row.net) + "</strong></li>";
          }).join("") + "</ul></div></div>" +
          (b.hoard && b.hoard.length ? "<h4>囤貨券商</h4><ul class=\"stat-list\">" + b.hoard.slice(0, 6).map(function (row) {
            return "<li><span>" + esc(row.name) + "</span><strong>" + lotsShort(row.net) + "</strong></li>";
          }).join("") + "</ul>" : "") +
          (b.dayTrade && b.dayTrade.length ? "<h4>隔日沖主力分點</h4><ul class=\"stat-list\">" + b.dayTrade.slice(0, 6).map(function (row) {
            return "<li><span>" + esc(row.name) + "</span><strong>買 " + Math.round(row.buy / 1000) +
              "／賣 " + Math.round(row.sell / 1000) + "</strong></li>";
          }).join("") + "</ul>" : "");
      }
      $("chipx-out").innerHTML = '<article class="card"><h3>' + esc(r.stockId) + " · " + esc(r.bias) +
        ' <span class="tag ' + (r.tone.cls || "") + '">' + esc(r.tone.label) + "</span></h3>" +
        '<p class="fine">資料日 ' + esc(r.date || "—") + "</p>" +
        '<ul class="stat-list health-list">' + lights + "</ul>" +
        '<ul class="stat-list">' +
        "<li><span>近1日法人</span><strong class=\"" + (r.flows[1].total > 0 ? "up" : "down") + "\">" + lotsShort(r.flows[1].total) + "</strong></li>" +
        "<li><span>近5日法人</span><strong class=\"" + (r.flows[5].total > 0 ? "up" : "down") + "\">" + lotsShort(r.flows[5].total) + "</strong></li>" +
        "<li><span>近10日法人</span><strong class=\"" + (r.flows[10].total > 0 ? "up" : "down") + "\">" + lotsShort(r.flows[10].total) + "</strong></li>" +
        "<li><span>近20日法人</span><strong class=\"" + (r.flows[20].total > 0 ? "up" : "down") + "\">" + lotsShort(r.flows[20].total) + "</strong></li>" +
        "<li><span>主力成本20</span><strong>" + (r.cost20 != null ? fmt(r.cost20) : "—") + "</strong></li>" +
        "<li><span>主力成本60</span><strong>" + (r.cost60 != null ? fmt(r.cost60) : "—") + "</strong></li>" +
        "</ul>" + brokerBlock +
        '<p class="fine">' + esc(r.note || "") + "</p></article>";
      $("chipx-status").textContent = "完成。";
      chipCostLines = { cost20: r.cost20, cost60: r.cost60 };
    } catch (err) {
      $("chipx-status").textContent = err.message || "健檢失敗";
    }
  }

  async function runScreen() {
    if (!C) return;
    const strategy = $("screen-strategy").value;
    const days = Number($("screen-days").value) || 5;
    const wantMa = $("screen-ma20") && $("screen-ma20").checked;
    $("screen-status").textContent = "正在篩選法人條件…";
    $("screen-out").innerHTML = "";
    try {
      const pack = await C.screenChips(strategy, days);
      let rows = pack.rows || [];
      if (wantMa && rows.length) {
        $("screen-status").textContent = "再檢查月線（最多前 25 檔）…";
        const keep = [];
        const sample = rows.slice(0, 25);
        for (let i = 0; i < sample.length; i++) {
          const row = sample[i];
          try {
            const bars = await M.historyBars("tw." + row.code, row.code, 40);
            if (!bars || bars.length < 20) continue;
            let sum = 0;
            for (let j = bars.length - 20; j < bars.length; j++) sum += bars[j].c;
            const ma = sum / 20;
            const last = bars[bars.length - 1].c;
            if (last >= ma) keep.push(row);
          } catch (err) { /* skip */ }
        }
        rows = keep;
      }
      $("screen-out").innerHTML = '<article class="card"><h3>選股結果 · ' + rows.length + " 檔</h3>" +
        '<p class="fine">' + esc(pack.dateFrom) + "～" + esc(pack.dateTo) + " · " + esc(pack.note) + "</p>" +
        (rows.length
          ? '<ul class="stat-list">' + rows.map(function (row) {
            return "<li><button type=\"button\" class=\"linkish\" data-open-code=\"" + esc(row.code) +
              "\" data-open-name=\"" + esc(row.name) + "\">" + esc(row.name) + " " + esc(row.code) +
              "</button><strong class=\"up\">" + lotsShort(row.mainForce || row.totalSum) + "</strong></li>";
          }).join("") + "</ul>"
          : '<p class="note">沒有符合的標的。</p>') +
        "</article>";
      $("screen-status").textContent = "完成。";
    } catch (err) {
      $("screen-status").textContent = err.message || "選股失敗";
    }
  }

  async function runChipday() {
    if (!C) return;
    $("chipday-status").textContent = "正在讀 T86…";
    $("chipday-out").innerHTML = "";
    try {
      const pack = await C.chipDaily();
      function listBlock(title, rows, key) {
        return "<h4>" + title + "</h4><ul class=\"stat-list\">" + rows.map(function (row, i) {
          const v = row[key];
          const cls = v > 0 ? "up" : v < 0 ? "down" : "";
          return "<li><span>" + (i + 1) + ". " + esc(row.name) + " " + esc(row.code) +
            '</span><strong class="' + cls + '">' + lotsShort(v) + "</strong></li>";
        }).join("") + "</ul>";
      }
      $("chipday-out").innerHTML = '<article class="card"><h3>籌碼日報 ' + esc(pack.date) + "</h3>" +
        '<p class="fine">' + esc(pack.note) + "</p>" +
        '<div class="grid2"><div>' + listBlock("法人合計買超 Top", pack.buy.slice(0, 15), "total") +
        "</div><div>" + listBlock("法人合計賣超 Top", pack.sell.slice(0, 15), "total") +
        "</div></div>" +
        '<div class="grid2"><div>' + listBlock("外資買超", pack.foreignBuy.slice(0, 10), "foreign") +
        "</div><div>" + listBlock("投信買超", pack.trustBuy.slice(0, 10), "trust") +
        "</div></div></article>";
      $("chipday-status").textContent = "完成。";
    } catch (err) {
      $("chipday-status").textContent = err.message || "日報失敗";
    }
  }

  if ($("us-board-refresh")) $("us-board-refresh").addEventListener("click", loadUsBoard);
  if ($("pulse-refresh")) $("pulse-refresh").addEventListener("click", function () {
    loadPulse();
    loadUsBoard();
  });
  if ($("us-board-fold")) $("us-board-fold").addEventListener("click", function () {
    usBoardOpen = !usBoardOpen;
    syncUsBoardFoldUi();
  });
  if ($("us-brief-fold")) $("us-brief-fold").addEventListener("click", function () {
    usBriefOpen = !usBriefOpen;
    syncUsBoardFoldUi();
  });
  if ($("us-rows-fold")) $("us-rows-fold").addEventListener("click", function () {
    usRowsOpen = !usRowsOpen;
    syncUsBoardFoldUi();
  });
  if ($("pulse-out")) $("pulse-out").addEventListener("click", function (ev) {
    const btn = ev.target.closest("[data-pulse-fold]");
    if (!btn || !$("pulse-out").contains(btn)) return;
    const key = btn.getAttribute("data-pulse-fold");
    const body = $("pulse-out").querySelector('[data-pulse-body="' + key + '"]');
    if (!body) return;
    const open = body.hidden;
    body.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    const chev = btn.querySelector(".chart-fold-chevron");
    if (chev) chev.textContent = open ? "▾" : "▸";
  });
  if ($("chipx-token-save")) $("chipx-token-save").addEventListener("click", function () {
    if (!C) return;
    C.setToken($("chipx-token").value || "");
    syncChipxTokenStatus();
  });
  if ($("chipx-run")) $("chipx-run").addEventListener("click", runChipx);
  if ($("screen-run")) $("screen-run").addEventListener("click", runScreen);
  if ($("chipday-run")) $("chipday-run").addEventListener("click", runChipday);
  if ($("mops-run")) $("mops-run").addEventListener("click", runMops);
  if ($("mops-spec-fold")) $("mops-spec-fold").addEventListener("click", function () {
    const box = $("mops-spec");
    const btn = $("mops-spec-fold");
    if (!box || !btn) return;
    const open = box.hidden;
    box.hidden = !open;
    btn.setAttribute("aria-pressed", open ? "true" : "false");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    const chev = btn.querySelector(".chart-fold-chevron");
    if (chev) chev.textContent = open ? "▾" : "▸";
  });
  function onMopsFoldClick(ev) {
    const btn = ev.target.closest("[data-mops-fold]");
    if (!btn) return;
    const root = btn.closest("#mops-out, #stock-mops");
    if (!root) return;
    const key = btn.getAttribute("data-mops-fold");
    const body = root.querySelector('[data-mops-body="' + key + '"]');
    if (!body) return;
    const open = body.hidden;
    body.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    const chev = btn.querySelector(".chart-fold-chevron");
    if (chev) chev.textContent = open ? "▾" : "▸";
  }
  if ($("mops-out")) $("mops-out").addEventListener("click", onMopsFoldClick);
  if ($("stock-mops")) $("stock-mops").addEventListener("click", onMopsFoldClick);

  document.addEventListener("click", function (ev) {
    const btn = ev.target.closest("[data-open-code]");
    if (!btn) return;
    const code = btn.getAttribute("data-open-code");
    const name = btn.getAttribute("data-open-name") || code;
    if (!code) return;
    openSymbol({ secid: "tw." + code, code: code, name: name, market: "台股" });
  });

  const today = new Date();
  $("j-date").value = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  buildToggles();
  syncChartDetailsUi();
  bindToolMenuDrag();
  D.ready().catch(function () { /* 登入時再提示 */ });
  if (D.account()) {
    $("gate").hidden = true;
    $("app").hidden = false;
  }
  loadBook();
  paintChrome(true);
  paintTwii(true);
  startLiveClock();
  syncUsBoardFoldUi();
})();
